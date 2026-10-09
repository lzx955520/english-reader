import fs from "node:fs";
import path from "node:path";
import type { Feature } from "../src/types";
export interface Encryption {
  isEncryptionAvailable(): boolean;
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
  getSelectedStorageBackend?: () => string;
}
export class Vault {
  private memory: Partial<Record<Feature, string>> = {};
  constructor(
    private directory: string,
    private encryption: Encryption,
  ) {
    fs.mkdirSync(directory, { recursive: true });
  }
  private file(f: Feature) {
    return path.join(this.directory, `key-${f}.bin`);
  }
  get persistent() {
    return (
      this.encryption.isEncryptionAvailable() &&
      this.encryption.getSelectedStorageBackend?.() !== "basic_text"
    );
  }
  get(f: Feature) {
    if (this.memory[f]) return this.memory[f]!;
    const p = this.file(f);
    if (!fs.existsSync(p)) return "";
    if (!this.persistent) return "";
    try {
      return this.encryption.decryptString(fs.readFileSync(p));
    } catch {
      throw Error("系统无法解密密钥，请在设置中重新录入");
    }
  }
  set(f: Feature, key: string) {
    if (!key) {
      delete this.memory[f];
      if (fs.existsSync(this.file(f))) fs.unlinkSync(this.file(f));
      return;
    }
    if (!this.persistent)
      throw Error(
        "系统安全存储不可用，未保存密钥。Windows 使用 DPAPI；不会退回明文存储。",
      );
    const tmp = this.file(f) + ".tmp";
    fs.writeFileSync(tmp, this.encryption.encryptString(key), { mode: 0o600 });
    fs.renameSync(tmp, this.file(f));
  }
}
