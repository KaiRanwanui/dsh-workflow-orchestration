# 逐模块评审（循环体）

针对当前模块（${module}）评审其规格说明，产出评审结论。

## 输入

- 需求分析结果：`output/${project}/analysis.md`
- 模块规格：`spec/${module}/req.md`（如存在）

## 输出格式（output/${project}/review-${module}.md）

```markdown
# 模块评审: ${module}

## 结论
通过 / 需修改

## 问题清单
- ...

## 建议
- ...
```