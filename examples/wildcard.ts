const port = 8081;

import { Proxy } from "../";
const proxy = new Proxy();

proxy.use(Proxy.wildcard);

proxy.onError((ctx, err, errorKind) => {
  // ctx may be null
  const url = ctx?.clientToProxyRequest?.url || "";
  console.error(`${errorKind} on ${url}:`, err);
});

proxy.listen({ port });
console.log(`listening on ${port}`);
