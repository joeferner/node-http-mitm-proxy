import zlib from "zlib";
import type { IContext } from "../types";

export default {
  onResponse(ctx: IContext, callback: Function) {
    const serverToProxyResponse = ctx.serverToProxyResponse!;
    if (
      serverToProxyResponse.headers["content-encoding"]?.toLowerCase() == "gzip"
    ) {
      delete serverToProxyResponse.headers["content-encoding"];
      ctx.addResponseFilter(zlib.createGunzip());
    }
    return callback();
  },
  onRequest(ctx: IContext, callback: Function) {
    ctx.proxyToServerRequestOptions!.headers["accept-encoding"] = "gzip";
    return callback();
  },
};
