const port = 8081;

import { Proxy } from "../";
const proxy = new Proxy();

proxy.onError((ctx, err, errorKind) => {
  // ctx may be null
  const url = ctx?.clientToProxyRequest?.url || "";

  console.error(`${errorKind} on ${url}:`, err);
});

proxy.onRequest((ctx, callback) => {
  ctx.proxyToClientResponse.end("Hacked, you cannot proceed to the website");
  // no callback() so proxy request is not sent to the server
});

proxy.listen({ port });
console.log(`listening on ${port}`);
