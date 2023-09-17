import { Bot, Context, Logger, Schema } from "koishi";
import typia from "typia";

export interface Config {
  path: string;
  limit: string[];
}

export const name = "api-bots";
const logger = new Logger(name);

export const Config: Schema<Config> = Schema.object({
  path: Schema.string()
    .default("/bots")
    .description("相对路径，受 api 服务的主路径影响"),
  limit: Schema.array(String).description("限制能访问该 API 的 UID。"),
});

export function apply(ctx: Context, config: Config, basePath: string) {
  const path = basePath + config.path;

  if (config.limit.length != 0) {
    ctx.router.use(path, (ctx, next) => {
      const uid = ctx.headers["uid"] as string;
      if (config.limit.includes(uid)) {
        return next;
      }
      ctx.response.status = 403;
      ctx.response.body = "You are not allowed to access this path.";
    });
  }

  ctx.router["get"](path, (context, _next) => {
    context.body = ctx.bots.map((bot) => bot.sid);
  });

  ctx.router.use(path + "/:sid", (rctx, next) => {
    const selfId = rctx.params.sid;
    const bot = ctx.bots[selfId];
    if (!bot) {
      rctx.response.status = 404;
      rctx.body = `Can not find bot with sid ${selfId}`;
      return;
    }
    rctx.bot = bot;
    return next;
  });

  ctx.router["get"](path + "/:sid", async (rctx, _next) => {
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

  ctx.router["post"](path + "/:sid" + "/message", async (rctx, _next) => {
    const validate = typia.json.validateParse<IMessageSender>(
      rctx.request.rawBody,
    );
    if (!validate.success) {
      rctx.response.status = 401;
      const error = validate.errors.map(
        (e) => `${e.path}: ${e.value} - ${e.expected}`,
      );
      rctx.body = error;
      return;
    }
    const data = validate.data;
    const bot: Bot = rctx.bot;

    if (data.guildId) {
      await bot.sendMessage(data.channelId, data.content, data.guildId);
    } else await bot.sendPrivateMessage(data.channelId, data.content);
  });

  logger.info("Bots Routers init successfully.");
}

interface IMessageSender {
  guildId?: string;
  channelId: string;
  content: string;
}
