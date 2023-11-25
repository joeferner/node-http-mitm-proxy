const port = 8081;
import path from "path";
import { Proxy } from "../";
const proxy = new Proxy();

proxy.onError((ctx, err, errorKind) => {
  // ctx may be null
  const url = ctx?.clientToProxyRequest?.url || "";

  console.error(`${errorKind} on ${url}:`, err);
});

proxy.onCertificateRequired = (hostname, callback) =>
  callback(null, {
    keyFile: path.resolve("/ca/certs/", `${hostname}.key`),
    certFile: path.resolve("/ca/certs/", `${hostname}.crt`),
  });

proxy.listen({ port });
console.log(`listening on ${port}`);
