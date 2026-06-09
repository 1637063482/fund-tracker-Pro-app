// AI 工具定义注册表 — JSON Schema 定义
// 设计原则：description 仅描述功能，使用规则/限制/警告统一在 System Prompt 中说明
// 参数 description 精简到最小必要信息，减少 token 开销
export const defineTools = (settings) => {
  const tools = [];

  // ── A. 净值行情 ──
  tools.push({
    type: "function",
    function: {
      name: "get_realtime_fund_data",
      description: "获取单只公募基金的最新净值、同类排名、阶段涨跌幅。≤3只，≥4只用get_batch_fund_data。",
      parameters: { type: "object", properties: { fundCode: { type: "string", description: "6位数基金代码" } }, required: ["fundCode"] }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "get_batch_fund_data",
      description: "批量查询多只基金(≤15只)最新净值和表现。4只及以上优先用此。",
      parameters: {
        type: "object",
        properties: { fundCodes: { type: "array", items: { type: "string" }, description: "基金代码数组，最多15只", maxItems: 15 } },
        required: ["fundCodes"]
      }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "get_fund_comparison",
      description: "横向对比2-5只基金：收益/排名/回撤/波动率/费率/规模/经理/相关性矩阵，输出综合评级。选基/换仓/阵型补充的核心工具。",
      parameters: {
        type: "object",
        properties: {
          fundCodes: { type: "array", items: { type: "string" }, description: "2-5个基金代码", minItems: 2, maxItems: 5 },
          aspect: { type: "string", enum: ["full", "returns", "risk", "cost"], description: "full=全面/returns=收益/risk=风控/cost=费率" }
        },
        required: ["fundCodes"]
      }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "get_fund_history_data",
      description: "获取单只基金近30个交易日净值序列，用于走势分析、画图、相关性计算。",
      parameters: { type: "object", properties: { fundCode: { type: "string", description: "6位数基金代码" } }, required: ["fundCode"] }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "get_market_historical_intraday",
      description: "获取指数/ETF多周期OHLC(开高低收)K线。日K 60根/周K 20根/月K 12根。复盘量价博弈、检测背离、识别支撑阻力。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "sh000001(上证)/sh511260(国债ETF)/sz399006(创业板)等" },
          period: { type: "string", enum: ["day", "week", "month"], description: "day默认60根/week=20根/month=12根" },
          count: { type: "number", description: "返回根数，最大100" }
        },
        required: ["code"]
      }
    }
  });

  // ── B. 资讯搜索 ──
  tools.push({
    type: "function",
    function: {
      name: "get_financial_news",
      description: "⭐首选资讯工具。多源聚合：新浪财经4栏目+Tavily+Serper并行拉取，自动去重。仅用于新闻，禁查数字数据。",
      parameters: {
        type: "object",
        properties: { topic: { type: "string", enum: ["macro", "market", "bond", "fund"], description: "macro=宏观/market=A股/bond=债券/fund=基金" } },
        required: ["topic"]
      }
    }
  });

  if (settings.serperApiKey) {
    tools.push({
      type: "function",
      function: {
        name: "google_macro_search",
        description: "搜索引擎，查宏观经济政策、央行操作、突发事件等定性信息。禁查数字数据。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "搜索关键词" },
            timeRange: { type: "string", enum: ["qdr:d", "qdr:w", "qdr:m", "all"], description: "d=24h/w=1周/m=1月" }
          },
          required: ["query"]
        }
      }
    });
  }

  if (settings.tavilyApiKey) {
    tools.push({
      type: "function",
      function: {
        name: "tavily_news_search",
        description: "突发事件定向搜索、大盘异动原因、政策解读等定性信息。禁查数字数据。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "搜索关键词" },
            recency: { type: "string", enum: ["d1", "d3", "w1"], description: "d1=24h/d3=3天/w1=1周" }
          },
          required: ["query"]
        }
      }
    });
  }

  if (settings.exaApiKey) {
    tools.push({
      type: "function",
      function: {
        name: "exa_research",
        description: "深度研报搜索：机构策略分析、中长期宏观展望等长文内容。禁查净值/价格。",
        parameters: { type: "object", properties: { query: { type: "string", description: "搜索关键词" } }, required: ["query"] }
      }
    });
  }

  // ── C. 实体操作 ──
  tools.push({
    type: "function",
    function: {
      name: "update_ledger",
      description: "记录买入/卖出/补录交易，支持批量。",
      parameters: {
        type: "object",
        properties: {
          actions: {
            type: "array",
            description: "记账指令数组",
            items: {
              type: "object",
              properties: {
                fundCode: { type: "string", description: "6位数基金代码" },
                fundName: { type: "string", description: "基金名称" },
                amount: { type: "number", description: "交易金额(元)" },
                actionType: { type: "string", enum: ["buy", "sell", "delete"] },
                date: { type: "string", description: "交易日期 YYYY-MM-DD" }
              },
              required: ["fundCode", "amount", "actionType"]
            }
          }
        },
        required: ["actions"]
      }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "manage_plan_todo",
      description: "增删改交易计划。日期必须绝对格式(如5/28)，禁用相对时间词。更新/删除需传入待办ID。",
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
                id: { type: "string", description: "update/delete时必填" },
                fundCode: { type: "string" },
                fundName: { type: "string" },
                tradeDirection: { type: "string", enum: ["buy", "sell", "observe"] },
                amount: { type: "number" },
                condition: { type: "string", description: "触发条件。绝对日期(5/28)或价格锚点(跌破1.5)。禁相对词。" },
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

  tools.push({
    type: "function",
    function: {
      name: "update_decision_memo",
      description: "写入/覆写战略备忘录。三层隔离:GLOBAL_CONSTITUTION(财富目标)/GLOBAL_MARKET(宏观锚点)/基金代码(个基纪律)。支持Markdown。",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "GLOBAL_CONSTITUTION/GLOBAL_MARKET/基金代码" },
          targetName: { type: "string" },
          decisionType: { type: "string", enum: ["BUY_STRATEGY", "HOLD_STRATEGY", "BLACK_LIST", "WATCH_GRID", "GLOBAL_MACRO"] },
          coreLogic: { type: "string", description: "核心逻辑。日期用绝对格式(5/28),价格锚点用数字。支持Markdown。" }
        },
        required: ["target", "targetName", "decisionType", "coreLogic"]
      }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "get_fund_holdings_penetration",
      description: "获取基金前十大重仓股明细（系统已预分类申万行业+预估算equityRatio）。双源蛋卷+东方财富，数据来自最新季报有1-2月滞后。",
      parameters: { type: "object", properties: { fundCode: { type: "string", description: "6位数基金代码" } }, required: ["fundCode"] }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "update_fof_dictionary",
      description: "将持仓穿透分析结果写入云端X-Ray字典。系统无法穿透总仓位(仅前十大JZBL)，用户可手动补充五栏(股票/债券/基金/现金/其他)精确占比。纯债/货币基金禁入库。",
      parameters: {
        type: "object",
        properties: {
          fundCode: { type: "string" },
          fundName: { type: "string" },
          equityRatio: { type: "number", description: "真实股票仓位比,如85%填0.85" },
          sectors: { type: "object", description: "申万一级行业分布,如{'电子':0.4,'医药':0.3}" },
          stockPct: { type: "number", description: "可选:股票占净值比,如22%填0.22。AI无法穿透时不填" },
          bondPct: { type: "number", description: "可选:债券占净值比" },
          fundPct: { type: "number", description: "可选:基金(FOF)占净值比" },
          cashPct: { type: "number", description: "可选:现金/存款占净值比" },
          otherPct: { type: "number", description: "可选:其他资产占净值比" }
        },
        required: ["fundCode", "fundName", "equityRatio", "sectors"]
      }
    }
  });

  // ── D. 可视化与计算 ──
  tools.push({
    type: "function",
    function: {
      name: "generate_trend_chart",
      description: "绘制金融图表：多基金净值对比、击球区色带、支撑阻力线。支持line/bar/area/scatter，14种预定义色，双Y轴。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "图表标题" },
          chartType: { type: "string", enum: ["line", "bar", "area", "scatter"] },
          labels: { type: "array", items: { type: "string" }, description: "X轴标签(日期)" },
          enableDualAxis: { type: "boolean", description: "启用双Y轴" },
          datasets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                data: { type: "array", items: { type: "number" } },
                color: { type: "string", description: "red/green/blue/orange/purple/yellow/cyan/pink/teal/indigo/amber/lime/rose/slate 或 #rrggbb" },
                fill: { type: "boolean" },
                dashed: { type: "boolean" },
                showPoints: { type: "boolean" },
                yAxisIndex: { type: "integer", description: "0=左轴/1=右轴" },
                chartType: { type: "string", enum: ["line", "bar", "area", "scatter"] }
              },
              required: ["label", "data"]
            }
          },
          horizontalLines: { type: "array", items: { type: "object", properties: { value: { type: "number" }, color: { type: "string" }, label: { type: "string" }, dashed: { type: "boolean" } }, required: ["value"] } },
          horizontalBands: { type: "array", items: { type: "object", properties: { yMin: { type: "number" }, yMax: { type: "number" }, color: { type: "string" }, label: { type: "string" } }, required: ["yMin", "yMax"] } },
          verticalLines: { type: "array", items: { type: "object", properties: { value: { type: "string" }, color: { type: "string" }, label: { type: "string" }, dashed: { type: "boolean" } }, required: ["value"] } },
          trendLines: { type: "array", items: { type: "object", properties: { x1: { type: "string" }, y1: { type: "number" }, x2: { type: "string" }, y2: { type: "number" }, color: { type: "string" }, label: { type: "string" }, dashed: { type: "boolean" } }, required: ["x1", "y1", "x2", "y2"] } },
          pointMarkers: { type: "array", items: { type: "object", properties: { x: { type: "string" }, y: { type: "number" }, color: { type: "string" }, label: { type: "string" } }, required: ["x", "y"] } }
        },
        required: ["title", "chartType", "labels", "datasets"]
      }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "execute_javascript",
      description: "JS数学引擎：复利/XIRR/相关系数(皮尔逊)/波动率/MDD等精确财务计算。代码必须以return结束。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "JS代码，必须以return结束" },
          reasoning: { type: "string", description: "代码目的说明" }
        },
        required: ["code", "reasoning"]
      }
    }
  });

  // ── E. 交易流水 ──
  tools.push({
    type: "function",
    function: {
      name: "get_fund_transaction_history",
      description: "查看某只基金的完整历史交易流水(买入/卖出/分红)。持仓摘要不含此明细，需主动调用。",
      parameters: {
        type: "object",
        properties: { fundCode: { type: "string", description: "6位数基金代码" } },
        required: ["fundCode"]
      }
    }
  });

  // ── F. 宏观与估值 ──
  tools.push({
    type: "function",
    function: {
      name: "get_index_valuation",
      description: "获取指数PE(TTM)/PB/ROE/股息率当前值及历史分位，含蛋卷评估标签。最多8个指数。PE为负→改用PB。",
      parameters: {
        type: "object",
        properties: { codes: { type: "string", description: "指数代码逗号分隔:000300(沪深300)/000016(上证50)/000905(中证500)/399006(创业板指)/000688(科创50)/000922(中证红利)/000852(中证1000)" } },
        required: []
      }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "get_cross_asset_data",
      description: "获取USD/CNY汇率、沪铜主力、SC原油主力、黄金(AU9999)实时价格与涨跌幅。F4打分前必须调用。",
      parameters: { type: "object", properties: {}, required: [] }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "get_bond_market_data",
      description: "获取国债指数(000012)与企债指数(000013)走势，输出信用利差方向和风险偏好信号。固收打分前必须调用。",
      parameters: { type: "object", properties: {}, required: [] }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "get_macro_data",
      description: "获取最新CPI同比(通胀)和制造业PMI(经济景气)。月度发布，有1-2月延迟。M2/社融/LPR需联网搜索补充。",
      parameters: { type: "object", properties: {}, required: [] }
    }
  });

  // ── G. 打分存储 ──
  tools.push({
    type: "function",
    function: {
      name: "get_recent_scores",
      description: "查询最近N个交易日的双核打分快照(权益F1-F4+动量修正+最终得分+固收分+上次CIO判定)，用于动量修正和滞回锁定。跨对话共享。",
      parameters: {
        type: "object",
        properties: { days: { type: "number", description: "查询最近几天，默认5天" } },
        required: []
      }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "store_scoring_snapshot",
      description: "保存当日双核打分完整快照到云端(每天多次打分仅保留最后一次)。必须附带量价环境+P&L快照(totalValue/totalProfit)，供自检回顾对比打分趋势与实际盈亏。",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "打分日期 ISO 如2026-06-05" },
          equity: {
            type: "object",
            description: "权益打分(未计算不传)",
            properties: {
              totalRaw: { type: "number" }, F1: { type: "number" }, F2: { type: "number" },
              F3: { type: "number" }, F4: { type: "number" },
              momentum: { type: "number", description: "动量修正 -10/+10/0" },
              final: { type: "number", description: "clamp(totalRaw+momentum,0,100)" },
              turnoverYi: { type: "number", description: "当日两市成交额(亿),如27927" },
              upCount: { type: "number", description: "上涨家数" },
              downCount: { type: "number", description: "下跌家数" },
              volumeRatio: { type: "number", description: "比例因子(近期均量÷8000亿,上限2.5)" },
              f3Flags: { type: "string", description: "F3档位说明,如'天量出货拦截'/'放量普涨'/'缩量阴跌'/'正常博弈'" }
            },
            required: ["totalRaw", "F1", "F2", "F3", "F4", "momentum", "final"]
          },
          bond: {
            type: "object",
            description: "固收打分(未计算不传)",
            properties: {
              totalRaw: { type: "number" }, F1: { type: "number" }, F2: { type: "number" },
              momentum: { type: "number" }, final: { type: "number" }
            },
            required: ["totalRaw", "F1", "F2", "momentum", "final"]
          },
          totalValue: { type: "number", description: "当日全盘总市值(元),从状态注入中取" },
          totalProfit: { type: "number", description: "当日累计盈亏(元)" },
          overallXirr: { type: "number", description: "当日年化XIRR(小数,如0.08=8%)" },
          verdict: {
            type: "object",
            description: "CIO判定(用于滞回锁定)",
            properties: {
              equityAction: { type: "string", enum: ["BUY_STRATEGY", "HOLD_STRATEGY", "WATCH_GRID", "BLACK_LIST"] },
              bondAction: { type: "string", enum: ["BUY_STRATEGY", "HOLD_STRATEGY", "WATCH_GRID", "BLACK_LIST"] },
              hysteresisActive: { type: "boolean" }
            },
            required: ["equityAction", "hysteresisActive"]
          }
        },
        required: ["date", "verdict"]
      }
    }
  });

  return tools;
};
