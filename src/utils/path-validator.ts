/**
 * 路径验证工具
 * 防止路径遍历攻击和不安全的文件操作
 */

import path from 'path';
import { createLogger } from './logger.js';

const logger = createLogger('PathValidator');

/**
 * 验证路径是否安全
 * @param inputPath 用户输入的路径
 * @param workspaceRoot 工作区根目录
 * @returns 验证结果和规范化的路径
 */
export function validatePath(
  inputPath: string,
  workspaceRoot: string
): { valid: boolean; normalizedPath?: string; error?: string } {
  try {
    // 1. 检查空路径
    if (!inputPath || inputPath.trim() === '') {
      return { valid: false, error: '路径不能为空' };
    }

    // 2. 检查危险字符
    const dangerousPatterns = [
      /\0/,           // NULL 字节
      /[<>"|?*]/,     // Windows 非法字符
      /\.\./,         // 路径遍历
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(inputPath)) {
        logger.warn(`检测到危险路径模式: ${inputPath}`);
        return { valid: false, error: '路径包含非法字符或模式' };
      }
    }

    // 3. 规范化路径
    const normalizedPath = path.normalize(inputPath);
    
    // 4. 解析为绝对路径
    const absolutePath = path.isAbsolute(normalizedPath)
      ? normalizedPath
      : path.resolve(workspaceRoot, normalizedPath);

    // 5. 确保路径在工作区内
    const normalizedWorkspace = path.normalize(workspaceRoot);
    if (!absolutePath.startsWith(normalizedWorkspace)) {
      logger.warn(`路径超出工作区范围: ${inputPath} -> ${absolutePath}`);
      return { 
        valid: false, 
        error: `路径必须在工作区内 (${normalizedWorkspace})` 
      };
    }

    // 6. 检查敏感系统目录
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const appData = process.env.APPDATA || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    
    const sensitiveDirectories = [
      // Linux/macOS 系统目录
      '/etc',
      '/sys',
      '/proc',
      '/boot',
      '/root',
      '/var/log',
      
      // Windows 系统目录
      'C:\\Windows\\System32',
      'C:\\Windows\\SysWOW64',
      'C:\\Windows\\system',
      'C:\\Program Files',
      'C:\\Program Files (x86)',
      
      // 用户敏感目录 (动态构建)
      ...(homeDir ? [
        path.join(homeDir, '.ssh'),
        path.join(homeDir, '.gnupg'),
        path.join(homeDir, '.aws'),
        path.join(homeDir, '.azure'),
        path.join(homeDir, '.config', 'gcloud'),
        path.join(homeDir, '.kube'),
        path.join(homeDir, '.npmrc'),
        path.join(homeDir, '.docker'),
      ] : []),
      
      // Windows 应用数据目录
      ...(appData ? [appData] : []),
      ...(localAppData ? [localAppData] : []),
    ];

    for (const sensitive of sensitiveDirectories) {
      // 规范化敏感目录路径并进行不区分大小写比较（Windows 兼容）
      const normalizedSensitive = path.normalize(sensitive);
      const isMatch = process.platform === 'win32'
        ? absolutePath.toLowerCase().startsWith(normalizedSensitive.toLowerCase())
        : absolutePath.startsWith(normalizedSensitive);
      
      if (isMatch) {
        logger.warn(`尝试访问敏感系统目录: ${absolutePath}`);
        return { 
          valid: false, 
          error: '不允许访问系统敏感目录' 
        };
      }
    }

    return { valid: true, normalizedPath: absolutePath };
  } catch (error) {
    logger.error('路径验证失败', error);
    return { 
      valid: false, 
      error: error instanceof Error ? error.message : '路径验证失败' 
    };
  }
}

/**
 * 验证文件内容是否安全
 * @param content 文件内容
 * @returns 验证结果
 */
export function validateFileContent(
  content: string
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // 1. 检查危险脚本标签
  if (/<script[^>]*>[\s\S]*?<\/script>/i.test(content)) {
    warnings.push('内容包含 <script> 标签');
  }

  // 2. 检查危险函数调用
  const dangerousFunctions = [
    /eval\s*\(/,
    /Function\s*\(/,
    /setTimeout\s*\(\s*["']/,  // setTimeout with string
    /setInterval\s*\(\s*["']/,
  ];

  for (const pattern of dangerousFunctions) {
    if (pattern.test(content)) {
      warnings.push(`内容包含潜在危险的函数调用: ${pattern.source}`);
    }
  }

  // 3. 检查系统命令
  const systemCommands = [
    /exec\s*\(/,
    /spawn\s*\(/,
    /execSync\s*\(/,
    /rm\s+-rf/,
    /sudo\s+/,
  ];

  for (const pattern of systemCommands) {
    if (pattern.test(content)) {
      warnings.push(`内容包含系统命令: ${pattern.source}`);
    }
  }

  // 如果有警告，记录但不阻止
  if (warnings.length > 0) {
    logger.warn(`文件内容安全检查发现 ${warnings.length} 个警告`);
    warnings.forEach(w => logger.debug(w));
  }

  return { valid: true, warnings };
}

/**
 * 获取安全的相对路径（用于显示）
 * @param absolutePath 绝对路径
 * @param workspaceRoot 工作区根目录
 * @returns 相对路径
 */
export function getSafeRelativePath(
  absolutePath: string,
  workspaceRoot: string
): string {
  try {
    const relativePath = path.relative(workspaceRoot, absolutePath);
    // 如果相对路径以 .. 开头，说明不在工作区内
    if (relativePath.startsWith('..')) {
      return absolutePath; // 返回绝对路径
    }
    return relativePath;
  } catch {
    return absolutePath;
  }
}
