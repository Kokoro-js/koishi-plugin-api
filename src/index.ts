import { Context, Dict, Logger, Time, Schema, Service, Router } from "koishi";
import {
  createHMAC,
  createSHA256,
  createSHA1,
  createMD5,
  createBLAKE3,
  createBLAKE2b,
  createBLAKE2s,
} from "hash-wasm";
import { randomUUID, createCipheriv } from "crypto";
import * as botsAPI from "./routers/bots";

export const name = "messenger-api";
const logger = new Logger(name);

declare module "koishi" {
  interface Context {
    api: API;
  }
}

export class API extends Service {
  private cacheRandomSet: Set<string> = new Set();
  private hmacArray = new Map<string, any>();
  public router: Router;

  private addRandom(value: string): void {
    if (this.cacheRandomSet.size >= this.config.maxSize) {
      const firstElement = this.cacheRandomSet.values().next().value; // 获取第一个元素
      this.cacheRandomSet.delete(firstElement); // 删除第一个元素
    }
    this.cacheRandomSet.add(value);
  }

  constructor(
    ctx: Context,
    public config: API.Config,
  ) {
    super(ctx, "api");

    ctx.command("testAPI <uid:string>").action(async (_, uid) => {
      uid = uid || Object.keys(config.tokens)[0];
      const timestamp = Date.now();
      const random = randomUUID();
      const sign = this.signAPI(timestamp, random, uid) as string;
      try {
        return await ctx.http.get(`http://127.0.0.1:5140${config.path}`, {
          headers: {
            timestamp,
            random,
            sign,
            uid,
          },
        });
      } catch (e) {
        return e.message;
      }
    });

    ctx.router.use(config.path, this.tokenValidationMiddleware);
    if (config.enable) ctx.router.use(config.path, this.dataDecryptMiddleware);

    ctx.router["get"](config.path, (ctx, _next) => {
      ctx.response.status = 200;
      ctx.body = "Good!";
    });

    if (config.botsAPI.enabled) {
      ctx.plugin(botsAPI, config.botsAPI, config.path);
    }
  }

  async start() {
    let hashFunc: any;
    const { tokens, hashType, signFormat } = this.config;
    switch (hashType) {
      case "SHA256":
        hashFunc = createSHA256();
        break;
      case "SHA1":
        hashFunc = createSHA1();
        break;
      case "MD5":
        hashFunc = createMD5();
        break;
      case "BLAKE3":
        hashFunc = createBLAKE3();
        break;
      case "BLAKE2s":
        hashFunc = createBLAKE2s();
        break;
      case "BLAKE2b":
        hashFunc = createBLAKE2b();
    }

    for (const key in tokens) {
      const token = tokens[key];
      const hmac = await createHMAC(hashFunc, token);
      this.hmacArray.set(key, hmac);
    }

    logger.info(this.config);
  }

  tokenValidationMiddleware = (ctx, next) => {
    const headers = ctx.request.headers;
    const sign = headers["sign"] as string;
    const random = headers["random"] as string;
    const timestamp = Number(headers["timestamp"]);
    const uid = headers["uid"] as string;

    const acceptableTimeDifferent = this.config.timeDifferent * Time.second;

    if (!(sign && random && timestamp)) {
      ctx.response.status = 401;
      ctx.body = "Missing necessary parameters.";
      return;
    }

    const serverTimestamp = Date.now();
    const timeDifference = Math.abs(serverTimestamp - timestamp);

    if (random.length > 36 || this.cacheRandomSet.has(random)) {
      ctx.response.status = 401;
      ctx.body =
        "The random number already exists on the server side, please sign again.";
      return;
    }
    this.addRandom(random);

    if (timeDifference >= acceptableTimeDifferent) {
      ctx.response.status = 401;
      ctx.body =
        "The timestamp being transmitted does not match the server's, please correct the time.";
      return;
    }

    const expect = this.signAPI(timestamp, random, uid);

    logger.info(expect, sign);

    if (expect !== sign) {
      ctx.response.status = 403;
      ctx.body = "Failed to verify your access.";
      return;
    }

    return next();
  };
  dataDecryptMiddleware = (ctx, next) => {
    const headers = ctx.request.headers;

    const uid = headers["uid"] as string;
    const sign = headers["sign"] as string;
    ctx.request.body = this.decryptData(ctx.request.body, uid, sign);

    return next();
  };

  public signAPI(timestamp: number, randomString: string, uid: string) {
    const token = this.config.tokens[uid];
    const hmac = this.hmacArray.get(uid);
    if (!token) return null;

    const replacements = {
      timestamp: timestamp.toString(),
      randomString: randomString,
      secret: token,
    };
    const pattern = /\${(.*?)}/g;
    const template = this.config.signFormat.replace(
      pattern,
      (match, key) => replacements[key] || match,
    );

    hmac.init();
    hmac.update(template);
    return hmac.digest("hex");
  }

  public encryptData(data: string, uid: string, iv: string) {
    const token = this.config.tokens[uid];
    if (!token) throw Error(`Can not find uid ${uid} with token registered.`);

    const algorithm = this.config.algorithm;
    let algorithmType =
      `${algorithm.type}-${algorithm.length}-${algorithm.pattern}`.toLowerCase();
    if (algorithm.type == "Chacha") algorithmType = "chacha20-poly1305";

    const cipher = createCipheriv(algorithmType, token, iv);
    let encrypted = cipher.update(data, "utf8", "hex");
    encrypted += cipher.final("hex");
    return encrypted;
  }

  public decryptData(encryptedData: string, uid: string, iv: string): string {
    const token = this.config.tokens[uid];
    if (!token) throw Error(`Can not find uid ${uid} with token registered.`);

    const algorithm = this.config.algorithm;
    let algorithmType =
      `${algorithm.type}-${algorithm.length}-${algorithm.pattern}`.toLowerCase();
    if (algorithm.type == "Chacha") algorithmType = "chacha20-poly1305";

    const decipher = createCipheriv(algorithmType, token, iv);
    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }
}

export namespace API {
  export interface Config {
    path: string;
    tokens: Dict<string>;
    signFormat: string;
    hashType: "SHA256" | "SHA1" | "MD5" | "BLAKE3" | "BLAKE2s" | "BLAKE2b";
    timeDifferent: number;
    maxSize: number;
    enable: boolean;
    algorithm: {
      type: string;
      length: string;
      pattern: string;
    };
    botsAPI?: botsAPI.Config & IPluginEnableConfig;
  }

  export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
      path: Schema.string().default("/api").description("API 暴露路径"),
      tokens: Schema.dict(Schema.string().default(randomUUID()))
        .role("table")
        .description("第一个写用户ID，第二个写签发的token")
        .default({ ahdg: randomUUID() }),
    }).description("API 设置"),
    Schema.object({
      botsAPI: pluginLoad(botsAPI.Config).description("添加信息相关API"),
    }).description("内置功能路由"),
    Schema.object({
      signFormat: Schema.string()
        .description("签名的形式")
        .default("${timestamp}:${randomString}:${secret}"),
      hashType: Schema.union([
        "SHA256",
        "SHA1",
        "MD5",
        "BLAKE3",
        "BLAKE2s",
        "BLAKE2b",
      ]).default("SHA256"),
      timeDifferent: Schema.natural()
        .min(1)
        .default(300)
        .description("时间戳的容差(以秒为计)"),
      maxSize: Schema.natural()
        .min(5)
        .default(10)
        .description("唯一随机数的缓存大小，仅用于短期防重放。"),
    }).description("安全相关"),
    Schema.object({
      enabled: Schema.boolean()
        .default(false)
        .description(
          "如果你在用 HTTPS 没必要开这玩意，如果你用 HTTP 而且希望数据得到保护可以开，但会影响性能。",
        ),
    }).description("数据加密"),
    Schema.union([
      Schema.object({
        enabled: Schema.const(true).required(),
        algorithm: Schema.object({
          type: Schema.union(["AES", "Chacha"]).default("AES"),
          length: Schema.union(["128", "192", "256"]).default("256"),
          pattern: Schema.union(["CCM", "GCM", "OCB", "CBC"])
            .description("部分老系统只有 CBC，请查看 openssl 支持的算法")
            .default("OCB"),
        }).description("数据加密"),
      }),
      Schema.object({}),
    ]),
  ]);

  // Thank you! Kbot!
  // https://github.com/Kabuda-czh/koishi-plugin-kbot/blob/master/plugins/kbot/src/index.ts#L116
  function pluginLoad<T>(schema: Schema<T>): Schema<T & IPluginEnableConfig> {
    return Schema.intersect([
      Schema.object({
        enabled: Schema.boolean().default(false).description("是否启用插件"),
      }),
      Schema.union([
        Schema.object({
          enabled: Schema.const(true).required(),
          ...schema.dict,
        }),
        Schema.object({
          enabled: Schema.const(false),
        }),
      ]) as Schema<T>,
    ]);
  }
  interface IPluginEnableConfig {
    enabled: boolean;
  }
}

Context.service("api");
export default API;
