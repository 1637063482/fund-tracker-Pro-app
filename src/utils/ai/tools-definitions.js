// 工具定义注册表：所有 AI tool JSON Schema 集中管理
// description 已精简，详细使用纪律统一在 system prompt 第三层维护（享受缓存）

export const defineTools = (settings) => {
  const tools = [];

  // 武器1：基金实时数据
  tools.push({
    type: "function",
    function: {
      name: "get_realtime_fund_data",
      description: "获取单只或少数(≤3只)公募基金的最新净值、同类排名、阶段涨跌幅。同时查≥4只请用 get_batch_fund_data 批量接口。",
      parameters: { type: "object", properties: { fundCode: { type: "string" } }, required: ["fundCode"] }
    }
  });

  // 武器2：宏观搜索 (Serper)
  if (settings.serperApiKey) {
    tools.push({
      type: "function",
      function: {
        name: "google_macro_search",
        description: "【仅限新闻/政策查询】搜索引擎，专门查询宏观经济政策、央行操作、突发金融事件等定性资讯。🚨 绝对禁止用于获取任何数字数据——净值用 get_realtime_fund_data，走势用 get_fund_history_data，指数用 get_market_historical_intraday。查到即接受，禁止无限重搜。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            timeRange: { type: "string", enum: ["qdr:d", "qdr:w", "qdr:m", "all"], description: "时间范围：qdr:d(24h), qdr:w(1周), qdr:m(1月), all(不限)。默认 qdr:d" }
          },
          required: ["query"]
        }
      }
    });
  }

  // 武器3：基金历史净值序列
  tools.push({
    type: "function",
    function: {
      name: "get_fund_history_data",
      description: "获取公募基金过去30个交易日的历史净值序列，用于走势分析、画图对比、相关性计算。",
      parameters: { type: "object", properties: { fundCode: { type: "string" } }, required: ["fundCode"] }
    }
  });

  // 武器4：新闻事件 (Tavily)
  if (settings.tavilyApiKey) {
    tools.push({
      type: "function",
      function: {
        name: "tavily_news_search",
        description: "【仅限新闻事件】专门查询大盘异动原因、突发财经新闻、政策解读等定性文字信息。搜索结果来自财联社、华尔街见闻等财经快讯源。🚨 禁止用于查任何数字类数据。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "如：'今日 A股 暴跌 核心原因'" },
            recency: { type: "string", enum: ["d1", "d3", "w1"], description: "新鲜度：d1(24h), d3(3天), w1(1周)" }
          },
          required: ["query"]
        }
      }
    });
  }

  // 武器5：深度研报 (Exa)
  if (settings.exaApiKey) {
    tools.push({
      type: "function",
      function: {
        name: "exa_research",
        description: "【仅限深度研报/观点】专门搜索机构研报、投资策略分析、中长期宏观展望等长文内容。🚨 禁止用于查净值、价格等具体数字。",
        parameters: { type: "object", properties: { query: { type: "string", description: "如：'创金合信中证红利低波动指数A 天天基金 最新季报 解读'" } }, required: ["query"] }
      }
    });
  }

  // 武器5b：东财财经快讯（替代搜索，直接返回结构化新闻 JSON）
  tools.push({
    type: "function",
    function: {
      name: "get_financial_news",
      description: "【首选财经资讯源】多源聚合引擎：新浪财经4栏目(综合/A股/债券/基金/全球) + Tavily+Serper搜索并行拉取，自动去重合并，一次调用覆盖全面消息面。topic: macro(宏观/全球) / market(A股/港股) / bond(债券) / fund(基金)。🚨 仅用于新闻资讯，禁止查数字数据。",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", enum: ["macro", "market", "bond", "fund"], description: "资讯主题：macro=宏观政策/央行/全球, market=A股/大盘异动, bond=债券市场, fund=基金相关" }
        },
        required: ["topic"]
      }
    }
  });

  // 武器6：批量记账
  tools.push({
    type: "function",
    function: {
      name: "update_ledger",
      description: "用户确认买入/卖出/补录交易时调用。支持批量传入多条记账指令。",
      parameters: {
        type: "object",
        properties: {
          actions: {
            type: "array",
            description: "记账指令数组",
            items: {
              type: "object",
              properties: {
                fundCode: { type: "string", description: "基金6位数代码" },
                fundName: { type: "string" },
                amount: { type: "number", description: "交易金额" },
                actionType: { type: "string", enum: ["buy", "sell", "delete"] },
                date: { type: "string", description: "交易日期，格式 YYYY-MM-DD" }
              },
              required: ["fundCode", "amount", "actionType"]
            }
          }
        },
        required: ["actions"]
      }
    }
  });

  // 武器7：画图
  tools.push({
    type: "function",
    function: {
      name: "generate_trend_chart",
      description: "绘制金融图表：多基金净值对比、击球区色带、支撑/阻力线、双Y轴。支持 line/bar/area/scatter，14种预定义色+hex色码。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "图表标题" },
          chartType: { type: "string", enum: ["line", "bar", "area", "scatter"], description: "图表主类型" },
          labels: { type: "array", items: { type: "string" }, description: "X轴标签" },
          enableDualAxis: { type: "boolean", description: "启用双Y轴(不同量纲数据对比时使用)" },
          datasets: {
            type: "array",
            description: "数据序列，每个数据集可独立指定颜色、线型、填充、点和所属Y轴",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "图例标签" },
                data: { type: "array", items: { type: "number" }, description: "数据值" },
                color: { type: "string", description: "颜色名(red/green/blue/orange/purple/yellow/cyan/pink/teal/indigo/amber/lime/rose/slate)或#rrggbb" },
                fill: { type: "boolean", description: "填充线条下方区域" },
                dashed: { type: "boolean", description: "虚线" },
                showPoints: { type: "boolean", description: "显示数据点标记" },
                yAxisIndex: { type: "number", enum: [0, 1], description: "0=左轴, 1=右轴" },
                chartType: { type: "string", enum: ["line", "bar", "area", "scatter"], description: "覆盖全局chartType" }
              },
              required: ["label", "data"]
            }
          },
          horizontalLines: {
            type: "array",
            description: "水平参考线（均线、净值、支撑阻力位、技术指标等），根据分析需要自行选择。⚠️ 只画关键内容，标注总数控制在≤5个，保持图表可读性。",
            items: {
              type: "object",
              properties: {
                value: { type: "number" },
                color: {
                  type: "string",
                  description: "强制由你(AI)决定！支持色名(red/green/blue/orange/purple/yellow/cyan/pink/teal/indigo/amber/lime/rose/slate)或#rrggbb。请根据业务语义自主配图，例如支撑位用 green，压力位用 red。"
                },
                label: { type: "string", description: "文字标注" },
                dashed: { type: "boolean", description: "默认true" }
              },
              required: ["value"]
            }
          },
          horizontalBands: {
            type: "array",
            description: "水平色带（击球区、估值带、通道带等），根据分析需要自行选择。⚠️ 只画关键内容，避免过度标注影响阅读。",
            items: {
              type: "object",
              properties: {
                yMin: { type: "number" },
                yMax: { type: "number" },
                color: {
                  type: "string",
                  description: "强制由你(AI)决定！支持色名(red/green/blue/orange/purple/yellow/cyan/pink/teal/indigo/amber/lime/rose/slate)或#rrggbb。请根据业务语义自主配图，例如支撑位用 green，压力位用 red。"
                },
                label: { type: "string", description: "文字标注" }
              },
              required: ["yMin", "yMax"]
            }
          },
          verticalLines: {
            type: "array",
            description: "竖直线，标记重要日期节点（买入日、分红日、政策事件、周期转折等）。⚠️ 只画关键事件，≤3条为宜。",
            items: {
              type: "object",
              properties: {
                value: { type: "string", description: "X轴标签值（日期），必须与labels中的某个值匹配，如 '04-15'" },
                color: {
                  type: "string",
                  description: "强制由你(AI)决定！支持色名或#rrggbb。"
                },
                label: { type: "string", description: "文字标注" },
                dashed: { type: "boolean", description: "默认true" }
              },
              required: ["value"]
            }
          },
          trendLines: {
            type: "array",
            description: "斜线/趋势线，连接两个数据坐标点（上升趋势线、下降通道、非水平支撑阻力等）。⚠️ 只画最核心的趋势结构线，≤2条为宜。",
            items: {
              type: "object",
              properties: {
                x1: { type: "string", description: "起点X轴标签（日期），如 '03-01'" },
                y1: { type: "number", description: "起点Y值" },
                x2: { type: "string", description: "终点X轴标签（日期），如 '04-15'" },
                y2: { type: "number", description: "终点Y值" },
                color: {
                  type: "string",
                  description: "强制由你(AI)决定！支持色名或#rrggbb。"
                },
                label: { type: "string", description: "文字标注" },
                dashed: { type: "boolean", description: "默认true" }
              },
              required: ["x1", "y1", "x2", "y2"]
            }
          },
          pointMarkers: {
            type: "array",
            description: "数据点标注，标记局部峰值、谷底、突破点、入场信号等关键点位。⚠️ 只画最重要的点位，≤3个为宜。",
            items: {
              type: "object",
              properties: {
                x: { type: "string", description: "X轴标签（日期），必须与labels中的某个值匹配" },
                y: { type: "number", description: "Y值（数据点数值）" },
                color: {
                  type: "string",
                  description: "强制由你(AI)决定！支持色名或#rrggbb。"
                },
                label: { type: "string", description: "标注文字" }
              },
              required: ["x", "y"]
            }
          }
        },
        required: ["title", "chartType", "labels", "datasets"]
      }
    }
  });

  // 武器8：JS 沙盒
  tools.push({
    type: "function",
    function: {
      name: "execute_javascript",
      description: "JS 数学引擎，用于复利、收益率倒算、相关性、波动率等精确财务计算。支持 Math 标准库，代码必须以 return 语句结束。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "JS 代码，如：'let p=80000; let r=0.035/12; let m=7; return p*Math.pow(1+r,m);'" },
          reasoning: { type: "string", description: "编写此代码的原因（供审计）" }
        },
        required: ["code", "reasoning"]
      }
    }
  });

  // 武器9：批量基金数据
  tools.push({
    type: "function",
    function: {
      name: "get_batch_fund_data",
      description: "批量查询多只基金(≤15只)的最新净值和表现。同时查≥4只时优先用此接口。",
      parameters: {
        type: "object",
        properties: { fundCodes: { type: "array", items: { type: "string" }, description: "基金代码数组，最多15只", maxItems: 15 } },
        required: ["fundCodes"]
      }
    }
  });

  // 武器9b：多基金横向对比
  tools.push({
    type: "function",
    function: {
      name: "get_fund_comparison",
      description: "【多基金横向对比引擎】同时比较2-5只基金的核心指标：收益(1/3/6/12月+3年)、排名、最大回撤、波动率、估值分位、费率(申购+管理估费)、规模、基金经理、相关性矩阵。用于选基决策、换仓评估、阵型补充。一次调用=6-9次手动工具调用，直接输出对比报告+综合评级。",
      parameters: {
        type: "object",
        properties: {
          fundCodes: { type: "array", items: { type: "string" }, description: "要对比的基金代码数组，2-5只", minItems: 2, maxItems: 5 },
          aspect: { type: "string", enum: ["full", "returns", "risk", "cost"], description: "对比侧重：full=全面(默认), returns=只看收益, risk=风控维度, cost=费率规模" }
        },
        required: ["fundCodes"]
      }
    }
  });

  // 武器10：待办管理
  tools.push({
    type: "function",
    function: {
      name: "manage_plan_todo",
      description: "新增/修改/删除交易计划。日期必须用绝对格式(如5/28)，禁止'明天''后天'等相对词。更新或删除现有计划必须传入待办ID。",
      parameters: {
        type: "object",
        properties: {
          plans: {
            type: "array",
            description: "待办指令数组",
            items: {
              type: "object",
              properties: {
                manageType: { type: "string", enum: ["add", "update", "delete"] },
                id: { type: "string", description: "更新/删除时必填：上下文中的字母数字ID" },
                fundCode: { type: "string", description: "新增时必填：基金代码" },
                fundName: { type: "string", description: "新增时必填：基金名称" },
                tradeDirection: { type: "string", enum: ["buy", "sell", "observe"] },
                amount: { type: "number", description: "计划交易金额" },
                condition: { type: "string", description: "触发条件" },
                priority: { type: "string", enum: ["high", "medium", "low"] }
              },
              required: ["manageType"]
            }
          }
        },
        required: ["plans"]
      }
    }
  });

  // 武器11：备忘录写入
  tools.push({
    type: "function",
    function: {
      name: "update_decision_memo",
      description: "写入或覆写战略备忘录。target: GLOBAL_CONSTITUTION(财富目标)/GLOBAL_MARKET(宏观锚点)/基金代码(个基纪律)。日期必须用绝对格式。",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "GLOBAL_CONSTITUTION / GLOBAL_MARKET / 基金代码" },
          targetName: { type: "string", description: "标的名称" },
          decisionType: { type: "string", enum: ["BUY_STRATEGY", "HOLD_STRATEGY", "BLACK_LIST", "WATCH_GRID", "GLOBAL_MACRO"] },
          coreLogic: { type: "string", description: "核心逻辑摘要，尽量精简" }
        },
        required: ["target", "targetName", "decisionType", "coreLogic"]
      }
    }
  });

  // 武器12：FOF 穿透字典
  tools.push({
    type: "function",
    function: {
      name: "update_fof_dictionary",
      description: "将持仓穿透分析结果(权益仓位、申万行业分布)写入云端字典。纯债/货币基金禁止入库。",
      parameters: {
        type: "object",
        properties: {
          fundCode: { type: "string", description: "基金代码" },
          fundName: { type: "string", description: "基金名称" },
          equityRatio: { type: "number", description: "真实股票仓位比例，如85%填0.85" },
          sectors: {
            type: "object",
            description: "申万一级行业分布，如 {'电子':0.4, '医药':0.3, '新能源':0.3}",
            additionalProperties: { type: "number" }
          }
        },
        required: ["fundCode", "fundName", "equityRatio", "sectors"]
      }
    }
  });

  // 武器13：持仓穿透
  tools.push({
    type: "function",
    function: {
      name: "get_fund_holdings_penetration",
      description: "获取基金前十大重仓股明细。拿到数据后归类申万行业、估算仓位，再调用 update_fof_dictionary 入库。",
      parameters: { type: "object", properties: { fundCode: { type: "string" } }, required: ["fundCode"] }
    }
  });

  // 武器14：交易流水查询
  tools.push({
    type: "function",
    function: {
      name: "get_fund_transaction_history",
      description: "查看某只基金的完整历史交易流水(买入/卖出/分红)。持仓摘要不含流水，需主动调用此工具获取。",
      parameters: {
        type: "object",
        properties: { fundCode: { type: "string", description: "基金6位数代码" } },
        required: ["fundCode"]
      }
    }
  });

  // 武器15：历史K线
  tools.push({
    type: "function",
    function: {
      name: "get_market_historical_intraday",
      description: "获取大盘或ETF过去20个交易日的OHLC(开高低收)数据及K线形态，用于复盘量价博弈。",
      parameters: {
        type: "object",
        properties: { code: { type: "string", description: "指数或ETF代码，如 sh000001(上证), sh511260(国债ETF)" } },
        required: ["code"]
      }
    }
  });

  return tools;
};
