import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { mergeConfigs, loadCliConfig, saveCliConfig, getHistoryPath } from '../../../src/config.js';

// Mock fs module
jest.mock('fs');
jest.mock('os');

describe('Config', () => {
  const mockHomeDir = '/mock/home';
  const mockConfigDir = path.join(mockHomeDir, '.config', 'bailu-cli');
  const mockConfigPath = path.join(mockConfigDir, 'config.json');

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear environment variables
    delete process.env.BAILU_API_KEY;
    delete process.env.BAILU_BASE_URL;
    delete process.env.BAILU_MODEL;
    delete process.env.BAILU_MODE;
    delete process.env.BAILU_CONFIG_DIR;
    
    // Mock os.homedir
    (os.homedir as jest.MockedFunction<typeof os.homedir>).mockReturnValue(mockHomeDir);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('mergeConfigs', () => {
    it('應該返回默認配置', () => {
      const config = mergeConfigs();
      
      expect(config.baseUrl).toBe('https://bailucode.com/openapi/v1');
      expect(config.model).toBe('bailu-2.6-preview');
      expect(config.safetyMode).toBe('review');
      expect(config.maxIterations).toBe(10);
      expect(config.autoCompress).toBe(true);
      expect(config.verbose).toBe(false);
    });

    it('應該使用環境變量覆蓋默認值', () => {
      process.env.BAILU_API_KEY = 'env-key';
      process.env.BAILU_MODEL = 'bailu-custom';
      process.env.BAILU_MODE = 'auto-apply';
      
      const config = mergeConfigs();
      
      expect(config.apiKey).toBe('env-key');
      expect(config.model).toBe('bailu-custom');
      expect(config.safetyMode).toBe('auto-apply');
    });

    it('應該使用 CLI 參數覆蓋所有其他配置', () => {
      process.env.BAILU_MODEL = 'env-model';
      
      const config = mergeConfigs({
        model: 'cli-model',
        verbose: true,
        maxIterations: 20
      });
      
      expect(config.model).toBe('cli-model');
      expect(config.verbose).toBe(true);
      expect(config.maxIterations).toBe(20);
    });

    it('應該正確合併多個配置源', () => {
      process.env.BAILU_API_KEY = 'env-key';
      
      const config = mergeConfigs({
        model: 'cli-model',
        safetyMode: 'dry-run'
      });
      
      expect(config.apiKey).toBe('env-key'); // 來自環境變量
      expect(config.model).toBe('cli-model'); // 來自 CLI 參數
      expect(config.safetyMode).toBe('dry-run'); // 來自 CLI 參數
      expect(config.baseUrl).toBe('https://bailucode.com/openapi/v1'); // 默認值
    });
  });

  describe('loadCliConfig', () => {
    it('應該返回空對象當配置文件不存在', () => {
      (fs.existsSync as jest.MockedFunction<typeof fs.existsSync>).mockReturnValue(false);
      
      const config = loadCliConfig();
      
      expect(config).toEqual({});
    });

    it('應該成功加載配置文件', () => {
      const mockConfig = {
        apiKey: 'test-key',
        model: 'bailu-2.6',
        safetyMode: 'review' as const
      };
      
      (fs.existsSync as jest.MockedFunction<typeof fs.existsSync>).mockReturnValue(true);
      (fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>).mockReturnValue(
        JSON.stringify(mockConfig)
      );
      
      const config = loadCliConfig();
      
      expect(config).toEqual(mockConfig);
    });

    it('應該處理損壞的 JSON 文件', () => {
      (fs.existsSync as jest.MockedFunction<typeof fs.existsSync>).mockReturnValue(true);
      (fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>).mockReturnValue(
        'invalid json'
      );
      
      const config = loadCliConfig();
      
      expect(config).toEqual({});
    });
  });

  describe('saveCliConfig', () => {
    it('應該創建配置目錄並保存配置', () => {
      (fs.existsSync as jest.MockedFunction<typeof fs.existsSync>).mockReturnValue(false);
      (fs.mkdirSync as jest.MockedFunction<typeof fs.mkdirSync>).mockImplementation();
      (fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>).mockImplementation();
      (fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>).mockReturnValue('{}');
      
      const newConfig = {
        apiKey: 'new-key',
        model: 'bailu-2.6'
      };
      
      saveCliConfig(newConfig);
      
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('bailu-cli'),
        { recursive: true }
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('config.json'),
        expect.stringContaining('new-key'),
        'utf8'
      );
    });

    it('應該合併現有配置', () => {
      const existingConfig = {
        apiKey: 'old-key',
        model: 'old-model'
      };
      
      (fs.existsSync as jest.MockedFunction<typeof fs.existsSync>).mockReturnValue(true);
      (fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>).mockReturnValue(
        JSON.stringify(existingConfig)
      );
      (fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>).mockImplementation();
      
      const newConfig = {
        model: 'new-model'
      };
      
      saveCliConfig(newConfig);
      
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('old-key'), // 保留舊的 apiKey
        'utf8'
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('new-model'), // 使用新的 model
        'utf8'
      );
    });
  });

  describe('getHistoryPath', () => {
    it('應該返回正確的歷史文件路徑', () => {
      const historyPath = getHistoryPath();
      
      expect(historyPath).toContain('bailu-cli');
      expect(historyPath).toContain('history.txt');
    });

    it('應該使用自定義配置目錄', () => {
      process.env.BAILU_CONFIG_DIR = '/custom/config';
      
      const historyPath = getHistoryPath();
      
      // Windows 會使用反斜線
      expect(historyPath).toContain('custom');
      expect(historyPath).toContain('config');
      expect(historyPath).toContain('history.txt');
    });
  });
});
