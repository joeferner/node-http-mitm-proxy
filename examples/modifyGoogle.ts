const port = 8081;

import { Proxy } from "../";
const proxy = new Proxy();

proxy.onError((ctx, err, errorKind) => {
  // ctx may be null
  const url = ctx?.clientToProxyRequest?.url || "";
  console.error(`${errorKind} on ${url}:`, err);
});

proxy.onRequest((ctx, callback) => {
  //console.log('REQUEST: http://' + ctx.clientToProxyRequest.headers.host + ctx.clientToProxyRequest.url);
  if (
    ctx.clientToProxyRequest.headers.host == "www.google.com" &&
    ctx.clientToProxyRequest.url?.indexOf("/search") == 0
  ) {
    ctx.use(Proxy.gunzip);

    ctx.onResponseData((ctx, chunk, callback) => {
      chunk = Buffer.from(
        chunk.toString().replace(/<h3.*?<\/h3>/g, "<h3>Pwned!</h3>")
      );
      return callback(null, chunk);
    });
  }
  return callback();
});

proxy.onRequestData(
  (
    ctx,
    chunk,
    callback //console.log('request data length: ' + chunk.length);
  ) => callback(null, chunk)
);

proxy.onResponse(
  (
    ctx,
    callback //console.log('RESPONSE: http://' + ctx.clientToProxyRequest.headers.host + ctx.clientToProxyRequest.url);
  ) => callback(null)
);

proxy.onResponseData(
  (
    ctx,
    chunk,
    callback //console.log('response data length: ' + chunk.length);
  ) => callback(null, chunk)
);

proxy.listen({ port });
console.log(`listening on ${port}`);
