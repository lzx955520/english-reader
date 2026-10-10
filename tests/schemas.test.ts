import { describe, expect, it } from "vitest";
import { model } from "../electron/schemas";

function accepts(baseUrl: string) {
  return model.safeParse({ provider: "compatible", model: "test-model", baseUrl }).success;
}
describe("provider URL literal-host validation", () => {
  it.each([
    "http://api.deepseek.com", "ftp://example.com", "not a URL",
    "https://user:password@example.com", "https://user@example.com",
    "https://example.com/v1?token=x", "https://example.com/v1#fragment",
    "https://localhost", "https://LOCALHOST.", "https://api.localhost",
    "https://127.0.0.1", "https://127.1", "https://2130706433",
    "https://0x7f000001", "https://0177.0.0.1", "https://0.0.0.0",
    "https://10.0.0.1", "https://169.254.169.254", "https://192.168.1.1",
    "https://172.16.0.1", "https://172.31.255.254",
    "https://[::]", "https://[::1]", "https://[0:0:0:0:0:0:0:1]",
    "https://[fc00::1]", "https://[FDFF::1]", "https://[fe80::1]",
    "https://[febf::1]", "https://[fec0::1]",
    "https://[::ffff:127.0.0.1]", "https://[::ffff:ac10:1]",
    "https://[::ffff:192.168.1.1]", "https://[::127.0.0.1]",
  ])("rejects %s", (url) => {
    expect(accepts(url)).toBe(false);
  });
  it.each([
    "https://api.deepseek.com", "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "https://api.siliconflow.cn/v1", "https://API.EXAMPLE.COM:8443/v1/",
    "https://172.15.255.254/v1", "https://172.32.0.1/v1",
    "https://8.8.8.8/v1", "https://[2606:4700:4700::1111]/v1",
    "https://[::ffff:8.8.8.8]/v1", "https://10.api.example.com/v1",
  ])("preserves configurable public endpoints such as %s", (url) => {
    expect(accepts(url)).toBe(true);
  });
});
