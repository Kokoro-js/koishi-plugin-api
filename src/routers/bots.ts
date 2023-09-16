import { Bot, Context, Logger, Schema } from "koishi";
import Router from "@koa/router";

export interface Config {
  router: Router;
  path: string;
  limit: string[];
}

export const name = "api-bots";
const logger = new Logger(name);

// @ts-ignore
export const Config: Schema<Config> = Schema.object({
  path: Schema.string()
    .default("/bots")
    .description("相对路径，受 api 服务的主路径影响"),
  limit: Schema.array(String).description("限制能访问该 API 的 UID。"),
});

export function apply(ctx: Context, config: Config) {
  const path = config.path;
  const newRouter = new Router();

  if (config.limit.length != 0) {
    newRouter.use((ctx, next) => {
      const uid = ctx.headers["uid"] as string;
      if (config.limit.includes(uid)) {
        return next;
      }
      ctx.response.status = 403;
      ctx.response.body = "You are not allowed to access this path.";
    });
  }

  newRouter["get"]("/", (context, _next) => {
    context.body = ctx.bots.map((bot) => bot.sid);
  });

  newRouter.use("/:sid", (rctx, next) => {
    let selfId = rctx.params.sid;
    const bot = ctx.bots[selfId];
    if (!bot) {
      rctx.response.status = 404;
      rctx.body = `Can not find bot with sid ${selfId}`;
      return;
    }
    logger.info(bot);
    rctx.bot = bot;
    return next();
  });

  newRouter["get"]("/:sid", async (rctx, _next) => {
    const bot: Bot = rctx.bot;
    const guildList = await bot.getGuildList();
    const joinedGuilds = guildList.map((guild) => guild.guildId);

    const data = {
      selfId: bot.selfId,
      platform: bot.platform,
      status: bot.status,
      username: bot.username,
      userId: bot.userId,
      joinedGuilds,
    };
    rctx.body = data;
  });

  newRouter["post"]("/:sid" + "/message", async (rctx, _next) => {
    const data: IMessageSender = rctx.request.body;
    const bot: Bot = rctx.bot;

    if (!data.channelId) {
      rctx.response.status = 401;
      rctx.response.body = "Need channelId to send message.";
    }

    if (data.guildId) {
      await bot.sendMessage(data.channelId, data.content, data.guildId);
    } else await bot.sendPrivateMessage(data.channelId, data.content);

    rctx.response.status = 200;
    rctx.body = `Send message successfully on channel ${data.channelId}`;
  });

  config.router = newRouter;
  logger.info("Bots Routers init successfully.");
}

interface IMessageSender {
  guildId?: string;
  channelId: string;
  content: string;
}
