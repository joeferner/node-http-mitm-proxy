import events from "events";

export class ProxyFinalResponseFilter extends events.EventEmitter {
  writable: boolean;
  write: any;
  end: any;

  constructor(proxy, ctx) {
    super();

    this.writable = true;

    this.write = function (chunk) {
      proxy._onResponseData(ctx, chunk, function (err, chunk) {
        if (err) {
          return proxy._onError("ON_RESPONSE_DATA_ERROR", ctx, err);
        }
        if (chunk) {
          return ctx.proxyToClientResponse.write(chunk);
        }
      });
      return true;
    };

    this.end = function (chunk) {
      if (chunk) {
        return proxy._onResponseData(ctx, chunk, function (err, chunk) {
          if (err) {
            return proxy._onError("ON_RESPONSE_DATA_ERROR", ctx, err);
          }

          return proxy._onResponseEnd(ctx, function (err) {
            if (err) {
              return proxy._onError("ON_RESPONSE_END_ERROR", ctx, err);
            }
            return ctx.proxyToClientResponse.end(chunk || undefined);
          });
        });
      } else {
        return proxy._onResponseEnd(ctx, function (err) {
          if (err) {
            return proxy._onError("ON_RESPONSE_END_ERROR", ctx, err);
          }
          return ctx.proxyToClientResponse.end(chunk || undefined);
        });
      }
    };

    return this;
  }
}
