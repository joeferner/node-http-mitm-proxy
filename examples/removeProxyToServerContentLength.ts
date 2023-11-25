const port = 8081;

import { Proxy } from "../";
const proxy = new Proxy();

proxy.onRequest((ctx, callback) => {
  if (
    ctx.proxyToServerRequestOptions !== undefined &&
    "content-length" in ctx.proxyToServerRequestOptions.headers
  ) {
    console.log(
      `found "content-length" header in request to "${ctx.proxyToServerRequestOptions.host}${ctx.proxyToServerRequestOptions.path}". Removing.`
    );
    delete ctx.proxyToServerRequestOptions.headers["content-length"];
  }
  callback();
});

proxy.listen({ port });
console.log(`listening on ${port}`);
