// web-research 返回值解析器。整个文件必须是一个表达式，供 codemode 里 eval 使用：
//   const P = eval(await tools.read({ path: "<本文件绝对路径>", offset: null, limit: null }));
({
  // CallToolResult -> 正文；isError 或无正文时抛错，交给 safe() 兜底
  body(r) {
    const parts = ((r && r.content) || []).map((c) => c.text || "").filter(Boolean);
    const text = parts.join("\n");
    if (r && r.isError) throw new Error("MCP isError: " + text.slice(0, 300));
    if (!text) throw new Error("MCP 结果没有 text 内容");
    return text;
  },

  // exa web_fetch_exa：每页以 "# 标题\nURL: ...\n" 开头，多页直接拼接
  pages(t) {
    const re = /^# (.*)\nURL: (.*)\n/gm;
    const hits = [];
    let m;
    while ((m = re.exec(t))) hits.push({ at: m.index, end: re.lastIndex, title: m[1].trim(), url: m[2].trim() });
    return hits.map((h, i) => ({
      title: h.title,
      url: h.url,
      body: t.slice(h.end, i + 1 < hits.length ? hits[i + 1].at : t.length).trim(),
    }));
  },

  // exa web_search_exa：每条 "Title/URL/Published/Author/Highlights:" 五段
  search(t) {
    return t.split(/^Title: /m).slice(1).map((block) => {
      const lines = block.split("\n");
      const field = (k) => {
        const l = lines.find((x) => x.startsWith(k + ": "));
        return l ? l.slice(k.length + 2).trim() : "";
      };
      const i = block.indexOf("\nHighlights:\n");
      return {
        title: lines[0].trim(),
        url: field("URL"),
        published: field("Published"),
        author: field("Author"),
        body: i < 0 ? "" : block.slice(i + 13).trim(),
      };
    });
  },

  // context7 query_docs：按 "### 片段名 / Source: / 代码块" 分节
  docs(t) {
    return t.split(/^### /m).slice(1).map((sec) => {
      const nl = sec.indexOf("\n");
      const rest = nl < 0 ? "" : sec.slice(nl + 1);
      return {
        section: (nl < 0 ? sec : sec.slice(0, nl)).trim(),
        source: (rest.match(/^Source: (.*)$/m) || [])[1] || "",
        code: ((rest.match(/```[^\n]*\n([\s\S]*?)```/) || [])[1] || "").trim(),
        note: rest.replace(/```[\s\S]*?```/g, "").replace(/^Source: .*$/m, "").trim().slice(0, 300),
      };
    });
  },

  // 统一兜底：解析为空或抛错时保留原文片段，避免静默返回空数组
  safe(parse, t, limit = 600) {
    try {
      const items = parse(t || "");
      if (items && items.length) return { ok: true, count: items.length, items };
      return { ok: false, count: 0, error: "解析为空", raw: (t || "").slice(0, limit) };
    } catch (e) {
      return { ok: false, count: 0, error: String((e && e.message) || e), raw: (t || "").slice(0, limit) };
    }
  },
});
