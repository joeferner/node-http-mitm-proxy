# Description

- Special thanks to Joeferner for creating the great [node-http-mitm-proxy](https://github.com/joeferner/node-http-mitm-proxy) library
- This rewrite library allows you can get the full request body before the `onRequest` event is triggered
- I.e. If the request body doesn't meet your condition, you can prevent it to proceed to the real server.
- If you want to see what I have changed please check out [this pull request](https://github.com/kics223w1/custom-node-http-mitm-proxy/commit/12d8d94a127ac06182d8dcbcafbaa224a82df7de)

# Install

[![NPM version](https://img.shields.io/npm/v/custom-node-http-mitm-proxy.svg)](https://www.npmjs.com/package/custom-node-http-mitm-proxy)
[![](https://david-dm.org/joeferner/node-http-mitm-proxy.svg)](https://www.npmjs.com/package/custom-node-http-mitm-proxy)

`npm i custom-node-http-mitm-proxy`

# Example

```ts
proxy.onRequest(function (ctx, callbackOnRequest) {
  let requestBody: Buffer[] = [];

  proxy.onRequestData(function (ctx, chunk, callback) {
    requestBody.push(chunk);
    callback(null, chunk);
  });

  proxy.onRequestEnd(function (ctx, callback) {
    const rawBody = Buffer.concat(requestBodyBuffer);

    console.log("Request body before event onRequest has triggered: ", rawBody);

    // If the body doesn't meet your condition, just stop the process
    // ctx.proxyToClientResponse.end("Stop the request");

    callbackOnRequest();
  });
});
```
