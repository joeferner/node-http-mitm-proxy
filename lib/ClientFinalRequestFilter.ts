import events from "events";

export class ClientFinalRequestFilter extends events.EventEmitter {
  public writable: boolean;
  public write: (chunk: Buffer) => void;
  public end: (chunk: Buffer) => void;

  constructor(proxy, ctx) {
    super();
    this.writable = true;
    this.write = (chunk) => {
      proxy._onRequestData(ctx, chunk, (err, chunk) => {
        if (err) {
          return proxy._onError("ON_REQUEST_DATA_ERROR", ctx, err);
        }
        if (chunk) {
          // Save the chunk so we can use it later
          ctx.requestBodyBuffer.push(chunk);
        }
      });
      return true;
    };

    this.end = (chunk) => {
      if (chunk) {
        // Save the chunk so we can use it later
        ctx.requestBodyBuffer.push(chunk);

        return proxy._onRequestData(ctx, chunk, (err, chunk) => {
          if (err) {
            return proxy._onError("ON_REQUEST_DATA_ERROR", ctx, err);
          }

          return proxy._onRequestEnd(ctx, (err) => {
            if (err) {
              return proxy._onError("ON_REQUEST_END_ERROR", ctx, err);
            }
          });
        });
      } else {
        return proxy._onRequestEnd(ctx, (err) => {
          if (err) {
            return proxy._onError("ON_REQUEST_END_ERROR", ctx, err);
          }
        });
      }
    };
  }
}
