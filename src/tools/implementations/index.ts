/**
 * 導出所有工具實現
 */

export { readFileTool } from "./read_file.js";
export { writeFileTool } from "./write_file.js";
export { listDirectoryTool } from "./list_directory.js";
export { runCommandTool } from "./run_command.js";
export { execTool } from "./exec.js";
export { applyDiffTool } from "./apply_diff.js";
export { grepSearchTool } from "./grep_search.js";
export { fileSearchTool } from "./file_search.js";

import { Tool } from "../types.js";
import { readFileTool } from "./read_file.js";
import { writeFileTool } from "./write_file.js";
import { listDirectoryTool } from "./list_directory.js";
import { runCommandTool } from "./run_command.js";
import { execTool } from "./exec.js";
import { applyDiffTool } from "./apply_diff.js";
import { grepSearchTool } from "./grep_search.js";
import { fileSearchTool } from "./file_search.js";

/**
 * 所有內建工具的列表
 */
export const builtinTools: Tool[] = [
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  runCommandTool,
  execTool, // exec 是 run_command 的別名
  applyDiffTool,
  grepSearchTool,
  fileSearchTool,
];
