import { contextBridge, ipcRenderer } from "electron";
import type { ReaderAPI } from "../src/types";
const invoke = (channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(channel, ...args);
const api: ReaderAPI = {
  updateStatus: () => invoke("updateStatus"),
  checkUpdate: () => invoke("checkUpdate"),
  downloadUpdate: () => invoke("downloadUpdate"),
  cancelUpdate: () => invoke("cancelUpdate"),
  revealUpdate: () => invoke("revealUpdate"),
  state: () => invoke("state"),
  refresh: (force) => invoke("refresh", force),
  cancel: (id) => invoke("cancel", id),
  lookup: (word) => invoke("lookup", word),
  glosses: (id) => invoke("glosses", id),
  progress: (...args) => invoke("progress", ...args),
  saveCard: (input) => invoke("saveCard", input),
  review: (...args) => invoke("review", ...args),
  deleteCard: (id) => invoke("deleteCard", id),
  saveSettings: (...args) => invoke("saveSettings", ...args),
  ai: (request) => invoke("ai", request),
  backup: () => invoke("backup"),
  restore: () => invoke("restore"),
  exportCards: () => invoke("exportCards"),
  openSource: (url) => invoke("openSource", url),
  trackMinutes: (seconds) => invoke("trackMinutes", seconds),
};
contextBridge.exposeInMainWorld("reader", api);
window.addEventListener("online", () => {
  void invoke("refresh", true).catch(() => {});
});
