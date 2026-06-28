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
      description: "获取指数/ETF多周期OHLC(开高低收)K线，日K含ATR/RSI/MACD/筹码分布等量化指标。日K上线250根(1年)。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "sh000001(上证)/sh511260(国债ETF)/sz399006(创业板)等" },
          period: { type: "string", enum: ["day", "week", "month"], description: "day默认60根/week=20根/month=12根" },
          count: { type: "number", description: "返回根数，日K最大250(筹码分析用≥120根)" }
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
      description: "⭐首选资讯工具。三源聚合:RSSHub(央行/证监会/财联社/华尔街见闻)+新浪财经4栏目+Tavily/Serper,自动去重排序。实时快讯+标题摘要。仅用于新闻,禁查数字数据。",
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

  // ── B0. Worker自搜（LLM指定关键词→Worker搜索+提取全文→返回完整正文）──
  tools.push({
    type: "function",
    function: {
      name: "worker_web_search",
      description: "⭐深度搜索:Worker根据你的关键词自主搜索财经网站+逐页提取完整正文(非snippet)→返回3000字全文。用于需要完整内容的深度搜索,比传统搜索返回更多信息。每次1-3个结果,耗时5-15秒。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词(≤30字,精炼)" },
          numResults: { type: "number", description: "返回结果数,默认3,最大5" }
        }, required: ["query"]
      }
    }
  });

  // ── B2. 深度阅读（搜索结果URL → 完整正文）──
  tools.push({
    type: "function",
    function: {
      name: "fetch_article_content",
      description: "⭐深度阅读：从搜索结果中挑选高质量URL→提取完整Markdown正文(去广告/去导航)。用于阅读政策全文/深度分析/研报。最多一次3篇。",
      parameters: {
        type: "object",
        properties: {
          urls: { type: "array", items: { type: "string" }, description: "1-3个URL，仅限财经媒体(cls.cn/wallstreetcn.com/jin10.com/stcn.com/caixin.com等)", maxItems: 3 }
        }, required: ["urls"]
      }
    }
  });

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

  // [FOF字典/穿透工具已删除 — 资产配置随持仓表格直接注入AI]

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
      description: "获取国内跨资产(汇率/铜/油/黄金/期货)。隔夜外盘已在上下文中注入,直接读取。F4打分前必须调用。",
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

  // ── G. 风险指标 ──
  tools.push({
    type: "function",
    function: {
      name: "get_fund_risk_metrics",
      description: "计算基金风险指标：年化收益/波动率/Sharpe/MDD(最大回撤+恢复天数)/vs基准(超额收益+跟踪误差+IR信息比率)。用于击球区MDD约束和选基决策。",
      parameters: {
        type: "object",
        properties: {
          fundCode: { type: "string", description: "基金6位数代码" },
          benchmark: { type: "string", description: "基准代码,默认sh000001(上证),可选sh000300(沪深300)" }
        },
        required: ["fundCode"]
      }
    }
  });

  // ── H. 打分存储 ──
  tools.push({
    type: "function",
    function: {
      name: "get_recent_scores",
      description: "查询最近N个交易日的双核打分快照(权益F1-F4+动量修正+最终得分+固收分+上次CIO判定)，用于动量修正和滞回锁定。跨对话共享。",
      parameters: {
        type: "object",
        properties: { days: { type: "number", description: "查询最近几天，默认10天" } },
        required: []
      }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "store_scoring_snapshot",
      description: "保存当日双核打分完整快照到云端(每天多次打分仅保留最后一次)。P&L字段可选附带供人工复盘,不参与自动判定。",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "打分日期 ISO 如2026-06-05" },
          equity: {
            type: "object",
            description: "权益打分(未计算不传)",
            properties: {
              totalRaw: { type: "number" },
              F1a: { type: "number", description: "F1a上证赔率得分(0-20)" },
              F1b: { type: "number", description: "F1b双创校验得分(0-15)" },
              F1: { type: "number", description: "F1总分=F1a+F1b(0-35), 旧格式兼容" },
              F2: { type: "number" }, F3: { type: "number" }, F4: { type: "number" },
              momentum: { type: "number", description: "动量修正 -10/+10/0" },
              final: { type: "number", description: "clamp(totalRaw+momentum,0,100)" },
              turnoverYi: { type: "number", description: "当日两市成交额(亿),如27927" },
              upCount: { type: "number", description: "上涨家数" },
              downCount: { type: "number", description: "下跌家数" },
              volumeRatio: { type: "number", description: "量比VR(今日成交÷近5日均量),如2.3" },
              f3Flags: { type: "string", description: "F3档位说明,如'天量出货拦截'/'放量普涨'/'缩量阴跌'/'正常博弈'" }
            },
            required: ["totalRaw", "F1a", "F1b", "F2", "F3", "F4", "momentum", "final"]
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
          northbound: {
            type: "object",
            description: "北向资金(🚨对话上下文中有【北向资金】块则必须保存,无则不用传)",
            properties: {
              shNet: { type: "number", description: "沪股通日净流入(亿)" },
              szNet: { type: "number", description: "深股通日净流入(亿)" },
              totalNet: { type: "number", description: "合计日净流入(亿)" }
            }
          },
          verdict: {
            type: "object",
            description: "CIO判定(用于滞回锁定)",
            properties: {
              equityAction: { type: "string", enum: ["BUY_STRATEGY", "HOLD_STRATEGY", "WATCH_GRID", "BLACK_LIST"] },
              bondAction: { type: "string", enum: ["BUY_STRATEGY", "HOLD_STRATEGY", "WATCH_GRID", "BLACK_LIST"] },
              hysteresisActive: { type: "boolean", description: "整体滞回状态" },
              equityHysteresis: { type: "boolean", description: "权益是否被滞回锁定(独立判定)" },
              bondHysteresis: { type: "boolean", description: "固收是否被滞回锁定(独立判定)" }
            },
            required: ["equityAction", "hysteresisActive", "equityHysteresis", "bondHysteresis"]
          }
        },
        required: ["date", "verdict"]
      }
    }
  });

  // ── J. 组合优化 ──
  tools.push({
    type: "function",
    function: {
      name: "run_portfolio_optimization",
      description: "【打完分后调用】运行BL组合优化：输入持仓+基金指标→BL大类最优+基金分同类加权→精确调仓建议。含协方差(EWMA)+BL后验+约束优化+基金评分卡(F1收益动量+F2风险调整+F3基准相对+F4成本纪律)。",
      parameters: {
        type: "object",
        properties: {
          funds: { type: "array", items: {
            type: "object", properties: {
              fundCode: { type: "string" }, fundName: { type: "string" },
              currentWeight: { type: "number", description: "当前占比(小数,如0.15=15%)" },
              equityScore: { type: "number", description: "权益打分0-100" },
              verdict: { type: "string", enum: ["BUY_STRATEGY","HOLD_STRATEGY","WATCH_GRID","BLACK_LIST"] },
              sharpe: { type: "number", description: "Sharpe比率(可选,从get_fund_risk_metrics获取)" },
              ir: { type: "number", description: "信息比率IR(可选)" },
              annualReturn: { type: "number", description: "年化收益小数(可选)" },
              mdd: { type: "number", description: "最大回撤小数如-0.15(可选)" },
              upCapture: { type: "number", description: "上行捕获率%(可选)" },
              downCapture: { type: "number", description: "下行捕获率%(可选)" },
              ranking: { type: "string", description: "同类排名 top25/25-50/50-75/bottom25(可选)" },
              feeRate: { type: "number", description: "年费率%(可选)" },
              isShortTerm: { type: "boolean", description: "⚠️短标记(可选)" },
              volatility: { type: "number", description: "年化波动率小数(可选)" }
            }, required: ["fundCode","currentWeight"]
          }},
          constitution: { type: "string", description: "GLOBAL_CONSTITUTION 备忘录文本,用于提取先验权重" }
        }, required: ["funds"]
      }
    }
  });

  // ── L. 回测验证 ──
  tools.push({
    type: "function",
    function: {
      name: "run_backtest",
      description: "⭐评分回测：读取历史打分快照+市场数据→计算方向准确率/分档胜率/前向衰减/校准评估。用于检验评分系统的预测效力，输出可直接反哺Ω校准。",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "回溯天数,默认60" }
        }, required: []
      }
    }
  });

  // ── K. 量化模型工具箱 ──
  tools.push({
    type: "function",
    function: {
      name: "run_monte_carlo",
      description: "蒙特卡洛模拟：基于历史日收益率+当前权重，生成N条未来路径，输出终值分布+VaR+回撤概率。用于回答'未来X天亏超Y%的概率'类问题。",
      parameters: {
        type: "object",
        properties: {
          fundCodes: { type: "array", items: { type: "string" }, description: "基金代码列表" },
          weights: { type: "array", items: { type: "number" }, description: "对应权重(小数)" },
          initialValue: { type: "number", description: "初始市值(元),默认从持仓取" },
          horizonDays: { type: "number", description: "模拟天数,默认60" },
          numSims: { type: "number", description: "模拟次数,默认3000,最大5000" }
        }, required: ["fundCodes", "weights"]
      }
    }
  });
  tools.push({
    type: "function",
    function: {
      name: "compute_covariance",
      description: "计算基金组合的EWMA协方差矩阵(λ=0.94)。输出矩阵+条件数+各资产边际风险贡献。用于风险预算、B-L先验、集中度检测。",
      parameters: {
        type: "object",
        properties: {
          fundCodes: { type: "array", items: { type: "string" }, description: "基金代码列表,2-15只" },
          lambda: { type: "number", description: "衰减因子,默认0.94" }
        }, required: ["fundCodes"]
      }
    }
  });
  tools.push({
    type: "function",
    function: {
      name: "compute_ou_half_life",
      description: "O-U均值回归半衰期:对净值序列做OLS回归,输出长期均值/回归速度θ/半衰期天数/当前偏离σ数。用于网格交易节奏优化——半衰期长→拉大档位,短→收紧档位。",
      parameters: {
        type: "object",
        properties: {
          fundCode: { type: "string", description: "基金代码" }
        }, required: ["fundCode"]
      }
    }
  });
  tools.push({
    type: "function",
    function: {
      name: "run_markov_regime",
      description: "Markov波动率制式转移:对日收益率序列做Hamilton滤波,输出低波制式/高波制式概率分布+转移矩阵。高波制式→F1a侧重MACD均线方向,低波制式→F1a侧重估值分位锚定。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "指数代码,默认sh000001(上证)" },
          days: { type: "number", description: "回溯天数,默认120" }
        }, required: []
      }
    }
  });

  // ── I. 深度微观结构探测器 ──
  tools.push({
    type: "function",
    function: {
      name: "get_market_microstructure",
      description: "【必调】获取A股深度微观结构信号(银行间流动性+期指基差+回购利率)，数据在后端做降维压缩，返回定性结论而非原始数据。用于F3量价验证的熔断判定：若返回'致命信号'则F3强制归零。",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  });

  // 行业资金流向 — 东财行业板块的主力净流入/净流出排名
  tools.push({
    type: "function",
    function: {
      name: "get_sector_capital_flow",
      description: "获取A股行业板块资金流向数据（东财行业分类），返回主力净流入/净流出TOP5行业及其金额、占比。用于判断当日资金主攻/主撤方向。",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  });

  return tools;
};
