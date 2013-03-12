# HTTP MITM Proxy

HTTP Man In The Middle (MITM) Proxy written in node.js. Supports capturing and modifying the request and response data.

# Example

This example will modify any search results coming from google and replace all the result titles with "Pwned!".

```javascript
var Proxy = require('http-mitm-proxy');
var proxy = Proxy();

proxy.onError(function(ctx, err) {
  console.error('proxy error:', err);
});

proxy.onRequest(function(ctx, callback) {
  if (ctx.clientToProxyRequest.headers.host == 'www.google.com'
    && ctx.clientToProxyRequest.url.indexOf('/search') == 0) {
    ctx.use(Proxy.gunzip);

    ctx.onResponseData(function(ctx, chunk, callback) {
      chunk = new Buffer(chunk.toString().replace(/<h3.*?<\/h3>/g, '<h3>Pwned!</h3>'));
      return callback(null, chunk);
    });
  }
  return callback();
});

proxy.listen(8081);
```

# SSL

Create a CA
```
cd ~/.http-mitm-proxy
openssl genrsa -out ca/ca.key 1024
openssl req -new -x509 -days 3650 -extensions v3_ca -keyout ca/cakey.pem -out ca/cacert.pem -config /etc/ssl/openssl.cnf
echo "02" > ca/cacert.srl

openssl genrsa -out www.google.com-key.pem 1024
openssl req -new -key www.google.com-key.pem -out www.google.com.pem
openssl x509 -req -days 3650 -CA ca/cacert.pem -CAkey ca/cakey.pem -in www.google.com.csr -out www.google.com-cert.pem
```

Import ca/cacert.pem into the browser.

# API

## Proxy
 * [listen](#proxy_listen)
 * [onError](#proxy_onError)
 * [onRequest](#proxy_onRequest)
 * [onRequestData](#proxy_onRequestData)
 * [onResponse](#proxy_onResponse)
 * [onResponseData](#proxy_onResponseData)
 * [use](#proxy_use)

## Context

 Context functions only effect the current request/response. For example you may only want to gunzip requests
 made to a particular host.

 * [onError](#proxy_onError)
 * [onRequest](#proxy_onRequest)
 * [onRequestData](#proxy_onRequestData)
 * [addRequestFilter](#context_addRequestFilter)
 * [onResponse](#proxy_onResponse)
 * [onResponseData](#proxy_onResponseData)
 * [addResponseFilter](#context_addResponseFilter)
 * [use](#proxy_use)

<a name="proxy"/>
## Proxy

<a name="proxy_listen" />
### proxy.listen

Starts the proxy listening on the given port.

__Arguments__

 * port - The port to listen on.

__Example__

    proxy.listen(80);

<a name="proxy_onError" />
### proxy.onError(fn) or ctx.onError(fn)

Adds a function to the list of functions to get called if an error occures.

__Arguments__

 * fn(ctx, err) - The function to be called on an error.

__Example__

    proxy.onError(function(ctx, err) {
      console.error('error in proxy for url:', ctx.clientToProxyRequest.url, err);
    });

<a name="proxy_onRequest" />
### proxy.onRequest(fn) or ctx.onRequest(fn)

Adds a function to get called at the beginning of a request.

__Arguments__

 * fn(ctx, callback) - The function that gets called on each request.

__Example__

    proxy.onRequest(function(ctx, callback) {
      console.log('REQUEST:', ctx.clientToProxyRequest.url);
      return callback();
    });

<a name="proxy_onRequestData" />
### proxy.onRequestData(fn) or ctx.onRequestData(fn)

Adds a function to get called for each request data chunk (the body).

__Arguments__

 * fn(ctx, chunk, callback) - The function that gets called for each data chunk.

__Example__

    proxy.onRequestData(function(ctx, chunk, callback) {
      console.log('REQUEST DATA:', chunk.toString());
      return callback(null, chunk);
    });

<a name="proxy_onResponse" />
### proxy.onResponse(fn) or ctx.onResponse(fn)

Adds a function to get called at the beginning of the response.

__Arguments__

 * fn(ctx, callback) - The function that gets called on each response.

__Example__

    proxy.onResponse(function(ctx, callback) {
      console.log('BEGIN RESPONSE');
      return callback();
    });

<a name="proxy_onResponseData" />
### proxy.onResponseData(fn) or ctx.onResponseData(fn)

Adds a function to get called for each response data chunk (the body).

__Arguments__

 * fn(ctx, chunk, callback) - The function that gets called for each data chunk.

__Example__

    proxy.onResponseData(function(ctx, chunk, callback) {
      console.log('RESPONSE DATA:', chunk.toString());
      return callback(null, chunk);
    });

<a name="proxy_use" />
### proxy.use(module) or ctx.use(module)

Adds a module into the proxy. Modules encapsulate multiple life cycle processing functions into one object.

__Arguments__

 * module - The module to add. Modules contain a hash of functions to add.

__Example__

    proxy.use({
      onError: function(ctx, err) { },
      onRequest: function(ctx, callback) { return callback(); },
      onRequestData: function(ctx, chunk, callback) { return callback(null, chunk); },
      onResponse: function(ctx, callback) { return callback(); },
      onResponseData: function(ctx, chunk, callback) { return callback(null, chunk); }
    });

<a name="context"/>
## Context

<a name="context_addRequestFilter" />
### ctx.addRequestFilter(stream)

Adds a stream into the request body stream.

__Arguments__

 * stream - The read/write stream to add in the request body stream.

__Example__

    ctx.addRequestFilter(zlib.createGunzip());

<a name="context_addRequestFilter" />
### ctx.addResponseFilter(stream)

Adds a stream into the response body stream.

__Arguments__

 * stream - The read/write stream to add in the response body stream.

__Example__

    ctx.addResponseFilter(zlib.createGunzip());
