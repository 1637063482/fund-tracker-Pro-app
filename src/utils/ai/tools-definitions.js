// AI 工具定义注册表：集中管理所有 AI Function Calling 工具的 JSON Schema
// description 已精简：仅保留功能描述，使用规则/限制/警告统一在 System Prompt 中说明
export const defineTools = (settings) => {
  const tools = [];

  // 武器1：基金实时数据
  tools.push({
    type: "function",
    function: {
      name: "get_realtime_fund_data",
      description: "获取单只或少数(≤3只)公募基金的最新净值、同类排名、阶段涨跌幅。≥4只请用 get_batch_fund_data。",
      parameters: { type: "object", properties: { fundCode: { type: "string", description: "基金6位数代码" } }, required: ["fundCode"] }
    }
  });

  // 武器2：宏观搜索 (Serper)
  if (settings.serperApiKey) {
    tools.push({
      type: "function",
      function: {
        name: "google_macro_search",
        description: "搜索引擎，查询宏观经济政策、央行操作、突发金融事件等定性资讯。禁止用于获取数字数据。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "搜索关键词" },
            timeRange: { type: "string", enum: ["qdr:d", "qdr:w", "qdr:m", "all"], description: "qdr:d=24h, qdr:w=1周, qdr:m=1月, all=不限" }
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
      description: "获取公募基金过去30个交易日的历史净值序列，用于走势分析、画图、相关性计算。",
      parameters: { type: "object", properties: { fundCode: { type: "string", description: "基金6位数代码" } }, required: ["fundCode"] }
    }
  });

  // 武器4：新闻事件 (Tavily)
  if (settings.tavilyApiKey) {
    tools.push({
      type: "function",
      function: {
        name: "tavily_news_search",
        description: "查询大盘异动原因、突发财经新闻、政策解读等定性信息。禁止用于查数字数据。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "如：今日A股暴跌核心原因" },
            recency: { type: "string", enum: ["d1", "d3", "w1"], description: "d1=24h, d3=3天, w1=1周" }
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
        description: "搜索机构研报、投资策略分析、中长期宏观展望等长文内容。禁止用于查净值/价格。",
        parameters: { type: "object", properties: { query: { type: "string", description: "如：创金合信中证红利低波动指数A最新季报解读" } }, required: ["query"] }
      }
    });
  }

  // 武器5b：财经快讯聚合
  tools.push({
    type: "function",
    function: {
      name: "get_financial_news",
      description: "多源聚合财经资讯：新浪财经4栏目+Tavily+Serper并行拉取，自动去重。topic: macro/market/bond/fund。仅用于新闻资讯，禁止查数字。",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", enum: ["macro", "market", "bond", "fund"], description: "macro=宏观/全球, market=A股/港股, bond=债券, fund=基金" }
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
      description: "用户确认买入/卖出/补录交易时调用，支持批量传入多条记账指令。",
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
                fundName: { type: "string", description: "基金名称" },
                amount: { type: "number", description: "交易金额" },
                actionType: { type: "string", enum: ["buy", "sell", "delete"], description: "buy=买入, sell=卖出, delete=删除" },
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

  // 武器7：画图 — 参数最大，压缩重点
  tools.push({
    type: "function",
    function: {
      name: "generate_trend_chart",
      description: "绘制金融图表：多基金净值对比、击球区色带、支撑阻力线、双Y轴。支持 line/bar/area/scatter，14种预定义色。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "图表标题" },
          chartType: { type: "string", enum: ["line", "bar", "area", "scatter"], description: "图表类型" },
          labels: { type: "array", items: { type: "string" }, description: "X轴标签(日期)" },
          enableDualAxis: { type: "boolean", description: "启用双Y轴" },
          datasets: {
            type: "array",
            description: "数据序列",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "图例标签" },
                data: { type: "array", items: { type: "number" }, description: "数据值" },
                color: { type: "string", description: "色名(red/green/blue/orange/purple/yellow/cyan/pink/teal/indigo/amber/lime/rose/slate)或#rrggbb" },
                fill: { type: "boolean", description: "填充线条下方区域" },
                dashed: { type: "boolean", description: "虚线" },
                showPoints: { type: "boolean", description: "显示数据点标记" },
                yAxisIndex: { type: "integer", description: "0=左轴, 1=右轴" },
                chartType: { type: "string", enum: ["line", "bar", "area", "scatter"], description: "覆盖全局chartType" }
              },
              required: ["label", "data"]
            }
          },
          horizontalLines: {
            type: "array",
            description: "水平参考线。标注总数≤5个。",
            items: {
              type: "object",
              properties: {
                value: { type: "number", description: "Y轴数值" },
                color: { type: "string", description: "色名或#rrggbb" },
                label: { type: "string", description: "文字标注" },
                dashed: { type: "boolean", description: "默认true" }
              },
              required: ["value"]
            }
          },
          horizontalBands: {
            type: "array",
            description: "水平色带(击球区/估值带)。标注总数≤3个。",
            items: {
              type: "object",
              properties: {
                yMin: { type: "number", description: "下边界" },
                yMax: { type: "number", description: "上边界" },
                color: { type: "string", description: "色名或#rrggbb" },
                label: { type: "string", description: "文字标注" }
              },
              required: ["yMin", "yMax"]
            }
          },
          verticalLines: {
            type: "array",
            description: "竖直线(重要日期)。≤3条。",
            items: {
              type: "object",
              properties: {
                value: { type: "string", description: "X轴标签值(日期)，需匹配labels中的值" },
                color: { type: "string", description: "色名或#rrggbb" },
                label: { type: "string", description: "文字标注" },
                dashed: { type: "boolean", description: "默认true" }
              },
              required: ["value"]
            }
          },
          trendLines: {
            type: "array",
            description: "斜线/趋势线。≤2条。",
            items: {
              type: "object",
              properties: {
                x1: { type: "string", description: "起点日期，如03-01" },
                y1: { type: "number", description: "起点Y值" },
                x2: { type: "string", description: "终点日期，如04-15" },
                y2: { type: "number", description: "终点Y值" },
                color: { type: "string", description: "色名或#rrggbb" },
                label: { type: "string", description: "文字标注" },
                dashed: { type: "boolean", description: "默认true" }
              },
              required: ["x1", "y1", "x2", "y2"]
            }
          },
          pointMarkers: {
            type: "array",
            description: "关键点位标注(峰/谷/突破/信号)。≤3个。",
            items: {
              type: "object",
              properties: {
                x: { type: "string", description: "X轴标签(日期)，需匹配labels中的值" },
                y: { type: "number", description: "数据点数值" },
                color: { type: "string", description: "色名或#rrggbb" },
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
      description: "JS数学引擎：复利、收益率倒算、相关性(皮尔逊)、波动率、MDD等精确财务计算。代码必须以return结束。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "JS代码，如：return 80000*Math.pow(1+0.035/12,7);" },
          reasoning: { type: "string", description: "编写此代码的原因(供审计)" }
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
      description: "批量查询多只基金(≤15只)的最新净值和表现。≥4只时优先用此。",
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
      description: "横向对比2-5只基金的收益/排名/回撤/波动率/费率/规模/经理/相关性矩阵，输出综合评级。",
      parameters: {
        type: "object",
        properties: {
          fundCodes: { type: "array", items: { type: "string" }, description: "基金代码数组，2-5只", minItems: 2, maxItems: 5 },
          aspect: { type: "string", enum: ["full", "returns", "risk", "cost"], description: "full=全面, returns=只看收益, risk=风控, cost=费率规模" }
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
      description: "新增/修改/删除交易计划。日期必须用绝对格式(如5/28)，禁止相对词。更新/删除现有计划需传入待办ID。",
      parameters: {
        type: "object",
        properties: {
          plans: {
            type: "array",
            description: "待办指令数组",
            items: {
              type: "object",
              properties: {
                manageType: { type: "string", enum: ["add", "update", "delete"], description: "add=新增, update=修改, delete=删除" },
                id: { type: "string", description: "更新/删除时必填：待办ID" },
                fundCode: { type: "string", description: "基金代码" },
                fundName: { type: "string", description: "基金名称" },
                tradeDirection: { type: "string", enum: ["buy", "sell", "observe"], description: "buy=买入, sell=卖出, observe=观察" },
                amount: { type: "number", description: "计划交易金额" },
                condition: { type: "string", description: "触发条件。必须用绝对日期(如5/28)或价格锚点(如跌破1.5)。禁止相对时间词。" },
                priority: { type: "string", enum: ["high", "medium", "low"], description: "high=高优, medium=常规, low=低优" }
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
      description: "写入或覆写战略备忘录。target: GLOBAL_CONSTITUTION(财富目标)/GLOBAL_MARKET(宏观锚点)/基金代码(个基纪律)。日期必须用绝对格式。支持Markdown排版。",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "GLOBAL_CONSTITUTION / GLOBAL_MARKET / 基金代码" },
          targetName: { type: "string", description: "标的名称" },
          decisionType: { type: "string", enum: ["BUY_STRATEGY", "HOLD_STRATEGY", "BLACK_LIST", "WATCH_GRID", "GLOBAL_MACRO"], description: "战略标签" },
          coreLogic: { type: "string", description: "核心逻辑摘要。日期用绝对格式(如5/28)，价格锚点用数字。支持Markdown。" }
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
            description: "申万一级行业分布，键为行业名(字符串)，值为占比(0-1)，如{'电子':0.4,'医药':0.3}"
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
      description: "获取基金前十大重仓股明细→归类申万行业→估算仓位→调用 update_fof_dictionary 入库。",
      parameters: { type: "object", properties: { fundCode: { type: "string", description: "基金6位数代码" } }, required: ["fundCode"] }
    }
  });

  // 武器14：交易流水查询
  tools.push({
    type: "function",
    function: {
      name: "get_fund_transaction_history",
      description: "查看某只基金的完整历史交易流水(买入/卖出/分红)。持仓摘要不含流水明细，需主动调用。",
      parameters: {
        type: "object",
        properties: { fundCode: { type: "string", description: "基金6位数代码" } },
        required: ["fundCode"]
      }
    }
  });

  // 武器15：历史K线（多周期OHLC）
  tools.push({
    type: "function",
    function: {
      name: "get_market_historical_intraday",
      description: "获取指数/ETF多周期OHLC(开高低收)K线数据。默认日K 60根，可选周K/月K。用于复盘量价博弈、检测背离、识别支撑阻力。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "指数或ETF代码，如 sh000001(上证), sh511260(国债ETF)" },
          period: { type: "string", enum: ["day", "week", "month"], description: "day=日K(60根), week=周K(20根), month=月K(12根)" },
          count: { type: "number", description: "返回根数，最大100" }
        },
        required: ["code"]
      }
    }
  });

  // 指数估值
  tools.push({
    type: "function",
    function: {
      name: "get_index_valuation",
      description: "获取指数PE(TTM)/PB/ROE/股息率当前值及历史分位，支持一次查询最多8个指数。PE为负=指数整体亏损，需改用PB。",
      parameters: {
        type: "object",
        properties: {
          codes: { type: "string", description: "指数代码，逗号分隔。常用: 000300(沪深300), 000016(上证50), 000905(中证500), 399006(创业板指), 000922(中证红利), 000688(科创50), 000852(中证1000)" }
        },
        required: []
      }
    }
  });

  // 跨资产数据
  tools.push({
    type: "function",
    function: {
      name: "get_cross_asset_data",
      description: "一次获取人民币汇率(USD/CNY)、沪铜主力、SC原油主力、黄金(AU9999)的实时价格与涨跌幅。",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  });

  // 债市深度数据
  tools.push({
    type: "function",
    function: {
      name: "get_bond_market_data",
      description: "获取国债指数(000012)与企债指数(000013)的相对走势，输出信用利差方向和风险偏好信号。",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  });

  // 宏观经济指标
  tools.push({
    type: "function",
    function: {
      name: "get_macro_data",
      description: "获取最新宏观经济指标：CPI同比(通胀)、制造业PMI(经济景气)。M2/社融/LPR需补充联网搜索。数据月度发布，有1-2月延迟。",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  });

  // 打分历史快照读取
  tools.push({
    type: "function",
    function: {
      name: "get_recent_scores",
      description: "查询最近N个交易日(默认5天)的双核打分快照(权益分F1-F4+动量修正+最终得分+固收分+上次CIO判定)。跨对话共享。",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "查询最近几个自然日的打分快照，默认5天" }
        },
        required: []
      }
    }
  });

  // 打分快照存储 — 参数压缩重点
  tools.push({
    type: "function",
    function: {
      name: "store_scoring_snapshot",
      description: "保存当日双核打分完整快照到云端，供跨对话动量修正和滞回锁定查询。纯分析数据，自动存储。",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "打分日期，ISO格式如2026-06-05" },
          equity: {
            type: "object",
            description: "权益打分。未计算则不传。",
            properties: {
              totalRaw: { type: "number", description: "因子总分 F1+F2+F3+F4 (0-100)" },
              F1: { type: "number", description: "宏观赔率分 0-35" },
              F2: { type: "number", description: "微观反转分 0-25" },
              F3: { type: "number", description: "量能验证分 0-25" },
              F4: { type: "number", description: "跨资产确认分 0-15" },
              momentum: { type: "number", description: "动量修正 -10/+10/0" },
              final: { type: "number", description: "最终得分 = clamp(totalRaw+momentum, 0, 100)" }
            },
            required: ["totalRaw", "F1", "F2", "F3", "F4", "momentum", "final"]
          },
          bond: {
            type: "object",
            description: "固收打分。未计算则不传。",
            properties: {
              totalRaw: { type: "number", description: "因子总分 F1+F2 (0-100)" },
              F1: { type: "number", description: "宏观利率水位分 0-50" },
              F2: { type: "number", description: "股债跷跷板分 0-50" },
              momentum: { type: "number", description: "动量修正" },
              final: { type: "number", description: "最终得分" }
            },
            required: ["totalRaw", "F1", "F2", "momentum", "final"]
          },
          verdict: {
            type: "object",
            description: "CIO判定结论(用于滞回锁定)",
            properties: {
              equityAction: { type: "string", enum: ["BUY_STRATEGY", "HOLD_STRATEGY", "WATCH_GRID", "BLACK_LIST"], description: "权益最终指令" },
              bondAction: { type: "string", enum: ["BUY_STRATEGY", "HOLD_STRATEGY", "WATCH_GRID", "BLACK_LIST"], description: "固收最终指令" },
              hysteresisActive: { type: "boolean", description: "是否触发滞回锁定" }
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
