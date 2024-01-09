import {
  CognitoAccessToken,
  CognitoIdToken,
  CognitoRefreshToken,
  CognitoUser,
  CognitoUserPool,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { Amplify, Auth } from 'aws-amplify';
import * as constants from './const';
import Express from 'express';
import EventEmitter from 'events';
import ip from 'ip';
import fs from 'fs';
import fetch from 'node-fetch';
import { INDEXHTML, SUCCESSHTML } from './statichtml';
import path from 'path';

type Credentials = {
  idToken: string;
  accessToken: string;
  refreshToken: string;
};

Amplify.configure({
  Auth: {
    region: constants.COGNITO_AWS_REGION,
    userPoolId: constants.COGNITO_USER_POOL_ID,
    userPoolWebClientId: constants.COGNITO_USER_POOL_CLIENT,
    authenticationFlowType: 'CUSTOM_AUTH',
  },
});

let idToken: string | undefined;

const getCredentialsFromSession = async (user): Promise<Credentials | null> => {
  return new Promise<Credentials | null>((resolve) => {
    user.getSession((err, session) => {
      if (err) {
        resolve(null);
        return;
      }

      resolve({
        idToken: session.idToken.jwtToken,
        accessToken: session.accessToken.jwtToken,
        refreshToken: session.refreshToken.token,
      });
    });
  });
};

const logInWithStoredCreds = async (
  config,
  log,
  idToken,
  accessToken,
  refreshToken,
): Promise<Credentials | null> => {
  const userPool = new CognitoUserPool({
    UserPoolId: constants.COGNITO_USER_POOL_ID,
    ClientId: constants.COGNITO_USER_POOL_CLIENT,
  });
  const cognitoIdToken = new CognitoIdToken({
    IdToken: idToken,
  });
  const cognitoAccessToken = new CognitoAccessToken({
    AccessToken: accessToken,
  });
  const cognitoRefreshToken = new CognitoRefreshToken({
    RefreshToken: refreshToken,
  });

  let user: CognitoUser | null = new CognitoUser({
    Username: config.email,
    Pool: userPool,
  });
  user = await Auth.signIn(config.email, config.password).catch((err) => {
    log.error(`Failed to sign in for stored creds login attempt: ${err}`);
  });

  if (user) {
    user.setSignInUserSession(
      new CognitoUserSession({
        AccessToken: cognitoAccessToken,
        IdToken: cognitoIdToken,
        RefreshToken: cognitoRefreshToken,
      }),
    );

    return getCredentialsFromSession(user);
  }

  return null;
};

export const kwiksetLogin = async (config, log, api) => {
  log.debug('Running kwikset login');

  const kwiksetSavePath = path.join(api.user.storagePath(), 'homebridge-kwikset-halo.json');
  log.debug(`Storage path: ${kwiksetSavePath}`);

  let savedCreds;
  if (fs.existsSync(kwiksetSavePath)) {
    savedCreds = JSON.parse(fs.readFileSync(kwiksetSavePath, 'utf8'));
  }

  log.debug('Logging in via cached tokens');

  let credentials = savedCreds
    ? await logInWithStoredCreds(
        config,
        log,
        savedCreds.idToken,
        savedCreds.accessToken,
        savedCreds.refreshToken,
      )
    : null;
  if (!credentials) {
    log.warn('Failed to login with cached tokens, reauthenticating...');

    let user;
    try {
      user = await Auth.signIn(config.email, config.password);
    } catch (err) {
      log.error(`Failed to log in: ${err} - Make sure your username and password are correct.`);
      return false;
    }

    if (user.challengeName === 'CUSTOM_CHALLENGE') {
      await Auth.sendCustomChallengeAnswer(
        user,
        'answerType:generateCode,medium:phone,codeType:login',
      );
      log.info('Generated mfa code, waiting for input');

      let server: any = null;
      const mfaCodeSignal = new EventEmitter();
      const app = Express();
      app.get('/', (req, res) => {
        res.send(INDEXHTML);
      });
      app.get('/success', (req, res) => {
        res.send(SUCCESSHTML);
      });
      app.use(Express.urlencoded({ extended: true }));
      app.post('/submitmfa', (req, res) => {
        mfaCodeSignal.emit('code', req.body.code);
        mfaCodeSignal.once('authFeedback', async (success) => {
          if (success) {
            await res.redirect('/success');
            setTimeout(() => {
              server?.close();
            }, 7000);
          } else {
            res.redirect('/?error=bad+code');
          }
        });
      });

      server = app.listen(config.mfaPort, () => {
        log.info(`MFA server listening on http://${ip.address()}:${config.mfaPort}`);
      });

      let codeVerified = false;
      do {
        const authSuccess = await new Promise<boolean>((resolve) => {
          mfaCodeSignal.once('code', async (code) => {
            log.info(`Input received: ${code}. Verifying...`);
            await Auth.sendCustomChallengeAnswer(
              user,
              `answerType:verifyCode,medium:phone,codeType:login,code:${code}`,
            );
            try {
              const authenticatedUser = await Auth.currentAuthenticatedUser();
              credentials = await getCredentialsFromSession(authenticatedUser);
              resolve(true);
            } catch (err) {
              log.error(`Failed to verify mfa code: ${err} - Try again.`);
              resolve(false);
            }
          });
        });

        mfaCodeSignal.emit('authFeedback', authSuccess);
        codeVerified = authSuccess;
      } while (!codeVerified);
      log.info('Code verified!');

      const creds = await getCredentialsFromSession(await Auth.currentAuthenticatedUser());
      fs.writeFileSync(kwiksetSavePath, JSON.stringify(creds));
      log.debug('Credentials saved!');
    } else if (user.challengeName === undefined) {
      log.info('No auth challenge, proceeding...');
      return true;
    } else {
      log.error(`Unknown auth challenge name ${user.challengeName}`);
      return false;
    }
  }

  const refreshCreds = async () => {
    const user = await Auth.currentAuthenticatedUser();
    await new Promise<void>((resolve) => {
      user.refreshSession(user.getSignInUserSession().getRefreshToken(), (err, session) => {
        if (err) {
          log.error(`An error occurred refreshing session: ${err}`);
          return;
        }

        idToken = session.idToken.jwtToken;
        resolve();
      });
    });
  };

  setInterval(refreshCreds, 10 * 60 * 1000);
  await refreshCreds();
  log.info('Logged in!');
  return true;
};

export const apiRequest = async (log, opts: { path: string; method: string; body?: any }) => {
  const apiHeaders = {
    Host: constants.API_HOST,
    'User-Agent': constants.API_USER_AGENT,
    'Accept-Encoding': 'gzip',
    Authorization: `Bearer ${idToken}`,
  };

  return fetch(`https://${constants.API_HOST}/${opts.path}`, {
    method: opts.method,
    headers: apiHeaders,
    body: opts.body,
  });
};

export const fetchDevices = (log, homeId) => {
  return apiRequest(log, {
    path: `prod_v1/homes/${homeId}/devices`,
    method: 'GET',
  })
    .then((response) => response.json())
    .then((data: any) => data.data);
};
