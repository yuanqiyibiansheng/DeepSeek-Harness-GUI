// Host-side entry for dsh-modef: registers the durable settings namespace
// behind the "高级的推理强度选择" toggle in General settings. The browser
// half (exports["./client"]) reads the flag and conditionally claims the
// composer model seat.
import z from "@deepseek-ai/schemastery";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";

const name = "@magiczerowxy/dsh-modef";
// Official pattern (same as dsh-plugin-desktop): hard-inject the settings
// service; the fiber starts only once it is available.
const inject = ["settings"];

const NS = settingsNamespace("dsh-modef");
const Config = z.object({
  advancedEffort: z.boolean().default(true),
  effortStyle: z.string().default("spray-flow")
});

function apply(ctx, config) {
  try {
    ctx.settings.register(NS, Config, { base: config || {} });
  } catch (e) {
    // Duplicate namespace registration or a settings-provider issue: leave the
    // namespace unregistered so the settings card simply does not appear.
  }
}

export { Config, apply, inject, name };
