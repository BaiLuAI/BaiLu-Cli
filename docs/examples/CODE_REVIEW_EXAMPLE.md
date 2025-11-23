# 🔍 完整代码审查流程示例

## AI 应该做什么（强制步骤）

### 场景：用户要求添加导航栏

```
你: 为网站添加导航栏
```

---

## ✅ 正确的 AI 行为（完整流程）

### 第 1 步：探索项目结构
```
AI: [自動執行] list_directory "."

发现文件：
- index.html
- css/style.css
- js/main.js
```

### 第 2 步：读取现有代码
```
AI: [自動執行] read_file "index.html"

当前内容：
<!DOCTYPE html>
<html>
<head>
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <h1>欢迎</h1>
</body>
</html>

[自動執行] read_file "css/style.css"

当前样式：
h1 { color: blue; }
```

### 第 3 步：修改文件
```
AI: 现在我为你添加导航栏...

[需要確認] write_file "index.html"

新内容：
<!DOCTYPE html>
<html>
<head>
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <nav class="navbar">
        <a href="#home">首页</a>
        <a href="#about">关于</a>
    </nav>
    <h1>欢迎</h1>
</body>
</html>

用户: y

[需要確認] write_file "css/style.css"

新样式：
h1 { color: blue; }

.navbar {
    background: #333;
    padding: 10px;
}

.navbar a {
    color: white;
    margin: 0 10px;
}

用户: y
```

### 第 4 步：强制审查（不能跳过）

```
AI: ⚠️ 开始强制代码审查...

==== 审查步骤 a：代码完整性 ====

[自動執行] read_file "index.html"
✓ 正在检查 index.html...
✓ 未发现 TODO 或省略标记
✓ <link> 引用 css/style.css - 需要验证

[自動執行] list_directory "css"
✓ style.css 存在

✓ 所有 HTML 标签已正确闭合：
  - <html></html> ✓
  - <head></head> ✓
  - <body></body> ✓
  - <nav></nav> ✓

==== 审查步骤 b：语法和引用 ====

[自動執行] read_file "css/style.css"
✓ 检查 .navbar class...
✓ .navbar 在 HTML 中存在：<nav class="navbar">
✓ .navbar a 选择器匹配 <a> 标签
✓ CSS 语法正确，无缺失分号

==== 审查步骤 c：搜索潜在错误 ====

正在搜索常见错误模式...
✓ 无未闭合标签
✓ 无拼写错误（fucntion, calss 等）
✓ 无缺失引号
✓ 无重复 ID

==== 审查步骤 d：功能逻辑 ====

✓ 导航栏 HTML 结构完整
✓ 导航链接有 href 属性
✓ 样式完整（背景色、内边距、链接样式）
✓ 无需 JavaScript（纯 HTML/CSS 导航）

==== 审查步骤 e：无需修补 ====

所有检查都通过，无需修复。

==== 审查步骤 f：审查报告 ====

✅ 审查完成报告：
━━━━━━━━━━━━━━━━━━━━━━━━
✓ 代碼完整性: 通過
  - HTML 标签正确闭合
  - CSS 文件存在且被引用
  
✓ 語法正確性: 通過  
  - HTML 语法正确
  - CSS 语法正确
  
✓ 引用關聯: 通過
  - .navbar class 正确使用
  - .navbar a 选择器有效
  - css/style.css 引用正确
  
✓ 功能邏輯: 通過
  - 导航栏完整可用
  - 链接结构正确
  
✓ 發現並修復的問題: 0 個

✅ 所有代码审查通过，导航栏已成功添加！
━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## ❌ 错误的 AI 行为（需要避免）

### 错误 1：不执行审查

```
AI: [修改文件...]

用户: y

AI: ✅ 导航栏已添加！

❌ 没有审查！不知道代码是否正确！
```

### 错误 2：表面审查

```
AI: ✅ 审查完成，看起来没问题。

❌ 没有实际用 read_file 检查！
❌ 没有检查语法和引用！
❌ 没有详细报告！
```

### 错误 3：发现问题但不修复

```
AI: 审查发现：
- HTML 标签未闭合
- CSS 样式缺失

❌ 发现问题但没有修复！
✓ 应该立即用 write_file 修复，然后重新审查！
```

---

## 🔧 发现问题时的修补流程

### 示例：发现 HTML 标签未闭合

```
AI: ==== 审查步骤 a：代码完整性 ====

[自動執行] read_file "index.html"

⚠️ 发现问题：<nav class="navbar"> 缺少闭合标签 </nav>

==== 开始修补 ====

[需要確認] write_file "index.html"

修复后的内容：
<!DOCTYPE html>
<html>
<head>...</head>
<body>
    <nav class="navbar">
        <a href="#home">首页</a>
    </nav>  ← 添加闭合标签
    <h1>欢迎</h1>
</body>
</html>

用户: y

==== 重新审查 ====

[自動執行] read_file "index.html"
✓ <nav> 标签已正确闭合
✓ 所有检查通过

✅ 修补完成！
```

---

## 🎯 关键要点

### 必须做到：

1. ✅ **完成修改后立即审查**（不是可选的）
2. ✅ **用 read_file 实际读取文件**（不能靠记忆）
3. ✅ **逐项检查清单中的每一项**
4. ✅ **发现问题立即修复**
5. ✅ **修复后重新审查**
6. ✅ **提供详细的审查报告**

### 不能做：

1. ❌ 说"看起来没问题"就结束
2. ❌ 不实际读取文件就判断
3. ❌ 发现问题但不修复
4. ❌ 跳过审查步骤
5. ❌ 提供模糊的报告

---

## 📊 审查流程图

```
用户请求
   ↓
探索项目结构 (list_directory)
   ↓
读取现有代码 (read_file)
   ↓
修改文件 (write_file)
   ↓
┌─────────────────────┐
│  强制审查流程开始    │ ← 不能跳过
└─────────────────────┘
   ↓
[a] 代码完整性审查 (read_file 验证)
   ↓
[b] 语法和引用审查 (read_file + list_directory)
   ↓
[c] 搜索潜在错误 (分析代码)
   ↓
[d] 功能逻辑审查 (检查实现)
   ↓
发现问题? 
   │
   ├─ 是 → 修复 (write_file) → 回到步骤 a (重新审查)
   │         ↑                        │
   │         └────────────────────────┘
   │
   └─ 否 → 生成审查报告 → 完成
```

---

## 💡 实际使用建议

### 用户如何确认 AI 做了审查？

观察 AI 是否：
1. 在修改后重新用 `read_file` 读取文件
2. 用 `list_directory` 验证文件存在
3. 提供详细的审查报告（不只是"完成"）
4. 明确列出检查的项目和结果

### 如果 AI 没有审查怎么办？

```
你: 你没有执行代码审查，请重新审查刚才修改的文件

AI: 抱歉，现在开始强制审查...
[自動執行] read_file "index.html"
...
```

---

## 🚀 这就是完整的代码能力

有了这个强制审查流程，AI 将具备：

✅ **自我审查能力** - 主动检查代码
✅ **错误搜索能力** - 查找常见错误模式
✅ **自动修补能力** - 发现问题立即修复
✅ **完整性保证** - 确保所有引用和依赖正确

这才是真正的"完整代码能力"！
