// Static express routes aren't working
export const INDEXHTML = `<html>
<body>
  <h1>Enter Kwikset 2FA code</h1>
  <p>You may have to wait a few minutes for the code to propagate to your phone.</p>
  <form action="submitmfa" method="POST">
    <input name="code" type="text" placeholder="2FA code" />
    <input type="submit" value="Submit" />
  </form>
</body>
</html>`;

export const SUCCESSHTML = `<html>
<body>
  <h1>Successfully authenticated!</h1>
  <p>You may close this page</p>
</body>
</html>`;
