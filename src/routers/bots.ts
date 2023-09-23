import { Bot, Context, h, Logger, Schema } from "koishi";
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
        return next();
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

    rctx.state.bot = bot;
    return next();
  });

  newRouter["get"]("/:sid", async (rctx, _next) => {
    const bot: Bot = rctx.state.bot;
    const guildList = await bot.getGuildList();
    const joinedGuilds = guildList.map((guild) => guild.guildId);

    rctx.body = {
      selfId: bot.selfId,
      platform: bot.platform,
      status: bot.status,
      username: bot.username,
      userId: bot.userId,
      joinedGuilds,
    };
  });

  newRouter["get"]("/:sid/message", (context, next) => {
    const data: IBaseMessage = context.request.body;
    const bot: Bot = context.state.bot;

    context.state.content = h.parse(data.content);
    return next();
  });

  newRouter["post"]("/:sid/message", (context, next) => {
    const data: IBaseMessage = context.request.body;

    if (!data.channelId) {
      context.response.status = 401;
      context.response.body = "Need channelId to send message.";
      return;
    }

    if (!data.content) {
      context.response.status = 401;
      context.response.body = "Need content to send message.";
      return;
    }

    context.state.content = h.parse(data.content);
    return next();
  });

  newRouter["post"]("/:sid" + "/message/create", async (rctx, _next) => {
    const data: IMessageSender = rctx.request.body;
    const bot: Bot = rctx.state.bot;
    const content = rctx.state.content;

    const channelIds = data.channelId;
    let messageId: string[];

    if (typeof channelIds === "string") {
      if (data.guildId) {
        messageId = await bot.sendMessage(channelIds, content, data.guildId);
      } else messageId = await bot.sendPrivateMessage(channelIds, content);
    } else {
      messageId = await bot.broadcast(channelIds, content);
    }

    rctx.response.status = 200;
    rctx.body = {
      messageId,
      message: `Send message successfully on channel ${channelIds}`,
    };
  });

  newRouter["post"]("/:sid" + "/message/update", async (rctx, _next) => {
    const data: IMessageUpdate = rctx.request.body;
    const bot: Bot = rctx.state.bot;
    const content = rctx.state.content;

    await bot.editMessage(data.channelId, data.messageId, content);

    rctx.response.status = 200;
    rctx.body = `Update message ${data.messageId} successfully on channel ${data.channelId}`;
  });

  newRouter["post"]("/:sid" + "/message/delete", async (rctx, _next) => {
    const data: IMessageUpdate = rctx.request.body;
    const bot: Bot = rctx.state.bot;

    await bot.deleteMessage(data.channelId, data.messageId);

    rctx.response.status = 200;
    rctx.body = `Update message ${data.messageId} successfully on channel ${data.channelId}`;
  });

  config.router = newRouter;
  logger.info("Bots Routers init successfully.");
}

interface IBaseMessage {
  channelId: string;
  content: string;
}
interface IMessageSender {
  channelId: string | string[];
  guildId?: string;
  content: string;
}

interface IMessageUpdate extends IBaseMessage {
  messageId: string;
}
