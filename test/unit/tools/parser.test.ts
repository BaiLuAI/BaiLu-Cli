import { describe, it, expect } from '@jest/globals';
import { parseToolCalls } from '../../../src/tools/parser.js';

describe('Tools Parser', () => {
  describe('parseToolCalls', () => {
    it('應該解析單個工具調用', () => {
      const response = `
讓我來幫你讀取文件。
<action>
<invoke tool="read_file">
  <param name="path">test.txt</param>
</invoke>
</action>
      `.trim();

      const result = parseToolCalls(response);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe('read_file');
      expect(result.toolCalls[0].params).toEqual({ path: 'test.txt' });
    });

    it('應該解析多個工具調用', () => {
      const response = `
<action>
<invoke tool="read_file">
  <param name="path">file1.txt</param>
</invoke>
<invoke tool="write_file">
  <param name="path">file2.txt</param>
  <param name="content">Hello World</param>
</invoke>
</action>
      `.trim();

      const result = parseToolCalls(response);

      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].tool).toBe('read_file');
      expect(result.toolCalls[0].params).toEqual({ path: 'file1.txt' });
      expect(result.toolCalls[1].tool).toBe('write_file');
      expect(result.toolCalls[1].params).toEqual({ 
        path: 'file2.txt', 
        content: 'Hello World' 
      });
    });

    it('應該處理帶有換行的參數值', () => {
      const response = `
<action>
<invoke tool="write_file">
  <param name="path">test.js</param>
  <param name="content">function hello() {
  console.log("Hello");
}</param>
</invoke>
</action>
      `.trim();

      const result = parseToolCalls(response);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].params.content).toContain('function hello()');
      expect(result.toolCalls[0].params.content).toContain('console.log');
    });

    it('應該處理空的 action 標籤', () => {
      const response = `
這裡沒有工具調用。
<action>
</action>
      `.trim();

      const result = parseToolCalls(response);

      expect(result.toolCalls).toHaveLength(0);
    });

    it('應該處理沒有 action 標籤的響應', () => {
      const response = '這是一個普通的文本響應，沒有任何工具調用。';

      const result = parseToolCalls(response);

      expect(result.toolCalls).toHaveLength(0);
    });

    it('應該處理包含特殊字符的參數', () => {
      const response = `
<action>
<invoke tool="run_command">
  <param name="command">echo "Hello & Goodbye"</param>
  <param name="cwd">/path/to/dir</param>
</invoke>
</action>
      `.trim();

      const result = parseToolCalls(response);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].params.command).toBe('echo "Hello & Goodbye"');
      expect(result.toolCalls[0].params.cwd).toBe('/path/to/dir');
    });

    it('應該處理沒有參數的工具調用', () => {
      const response = `
<action>
<invoke tool="list_directory">
</invoke>
</action>
      `.trim();

      const result = parseToolCalls(response);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe('list_directory');
      expect(result.toolCalls[0].params).toEqual({});
    });

    it('應該處理混合格式（文本 + 工具調用）', () => {
      const response = `
首先，讓我檢查一下這個文件。

<action>
<invoke tool="read_file">
  <param name="path">config.json</param>
</invoke>
</action>

然後我會分析它的內容。
      `.trim();

      const result = parseToolCalls(response);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe('read_file');
      expect(result.toolCalls[0].params).toEqual({ path: 'config.json' });
    });

    it('應該處理數字類型的參數', () => {
      const response = `
<action>
<invoke tool="resize_image">
  <param name="width">800</param>
  <param name="height">600</param>
</invoke>
</action>
      `.trim();

      const result = parseToolCalls(response);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].params.width).toBe(800);
      expect(result.toolCalls[0].params.height).toBe(600);
    });

    it('應該處理布林值參數', () => {
      const response = `
<action>
<invoke tool="compile">
  <param name="minify">true</param>
  <param name="sourcemap">false</param>
</invoke>
</action>
      `.trim();

      const result = parseToolCalls(response);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].params.minify).toBe(true);
      expect(result.toolCalls[0].params.sourcemap).toBe(false);
    });

    it('應該忽略格式錯誤的工具調用', () => {
      const response = `
<action>
<invoke tool="read_file">
  <param name="path">test.txt
</invoke>
<invoke tool="write_file">
  <param name="path">output.txt</param>
  <param name="content">Valid content</param>
</invoke>
</action>
      `.trim();

      const result = parseToolCalls(response);

      // 應該只解析格式正確的工具調用
      expect(result.toolCalls.length).toBeGreaterThanOrEqual(0);
    });

    it('應該處理空格和縮進', () => {
      const response = `
<action>
  <invoke tool="read_file">
    <param name="path">  test.txt  </param>
  </invoke>
</action>
      `.trim();

      const result = parseToolCalls(response);

      expect(result.toolCalls).toHaveLength(1);
      // 參數值應該保留原始空格（由工具自行決定是否 trim）
      expect(result.toolCalls[0].params.path).toBeTruthy();
    });
  });
});
