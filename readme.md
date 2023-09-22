# koishi-plugin-api

[![npm](https://img.shields.io/npm/v/@ahdg/koishi-plugin-api?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-api)

Expose an API with Koishi to make various requests.

## Default:
- /api - [all] **Test your sign.**

### Bots plugin
- /api/bots - [get] **Get the list of bots.**
- /api/bots/:sid - [get] **Get the bot info with sid**
- /api/bots/:sid/message/create - [post] **Send a message with bot.**
1. channelId: string | string[];
2. guildId?: string;
3. content: string;

- /api/bots/:sid/message/update - [post] **Update a message**
1. channelId: string;
2. messageId: string;
3. content: string;

- /api/bots/:sid/message/delete - [post] **Recall a message**
1. channelId: string;
2. messageId: string;
