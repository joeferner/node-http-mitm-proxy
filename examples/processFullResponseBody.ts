const port = 8081;

import { Proxy } from "../";
const proxy = new Proxy();

proxy.onError((ctx, err, errorKind) => {
  // ctx may be null
  const url =
    ctx && ctx.clientToProxyRequest ? ctx.clientToProxyRequest.url : "";
  console.error(`${errorKind} on ${url}:`, err);
});

proxy.use(Proxy.gunzip);

proxy.onRequest((ctx, callback) => {
  const chunks = new Array<Buffer>();
  ctx.onResponseData((ctx, chunk, callback) => {
    chunks.push(chunk);
    return callback(null, undefined); // don't write chunks to client response
  });
  ctx.onResponseEnd((ctx, callback) => {
    let body: string | Buffer = Buffer.concat(chunks);
    if (
      ctx.serverToProxyResponse !== undefined &&
      ctx.serverToProxyResponse.headers["content-type"] &&
      ctx.serverToProxyResponse.headers["content-type"].indexOf("text/html") ===
        0
    ) {
      body = body.toString().replace(/Lucky/g, "Sexy");
    }
    ctx.proxyToClientResponse.write(body);
    return callback();
  });
  callback();
});

proxy.listen({ port });
console.log(`listening on ${port}`);
