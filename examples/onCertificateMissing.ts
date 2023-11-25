const port = 8081;
import { Proxy } from "../";
const proxy = new Proxy();

proxy.onError((ctx, err, errorKind) => {
  // ctx may be null
  const url = ctx?.clientToProxyRequest?.url || "";
  console.error(`${errorKind} on ${url}:`, err);
});

proxy.onCertificateMissing = (ctx, files, callback) => {
  console.log('Looking for "%s" certificates', ctx.hostname);
  console.log('"%s" missing', ctx.files.keyFile);
  console.log('"%s" missing', ctx.files.certFile);

  // Here you have the last chance to provide certificate files data
  // A tipical use case would be creating them on the fly
  //
  // return callback(null, {
  //   key: keyFileData,
  //   cert: certFileData
  // });
};

proxy.listen({ port });
console.log(`listening on ${port}`);
