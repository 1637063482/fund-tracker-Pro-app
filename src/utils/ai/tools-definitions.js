// 工具定义注册表：所有 AI tool JSON Schema 集中管理
// 每个工具返回 { name, schema } 结构

export const defineTools = (settings) => {
  const tools = [];

  // 🔫 武器1：基金专属 API
  tools.push({
    type: "function",
    function: {
      name: "get_realtime_fund_data",
      description: "【绝对精确金融API】当需要获取单只或少数(≤3只)公募基金的最新精确净值、同类排名、阶段涨跌幅等结构化数据时绝对优先调用此API。⚠️同时查≥4只请用 get_batch_fund_data 批量接口！🚨 致命使用纪律：当用户要求“推荐基金”时，绝对禁止为了盲目比较全市场基金，而在多轮循环中疯狂调用此接口查几十只基金！",
      parameters: { type: "object", properties: { fundCode: { type: "string" } }, required: ["fundCode"] }
    }
  });

  // 🔫 武器2：宏观数字狙击枪 (Serper)
  if (settings.serperApiKey) {
    tools.push({
      type: "function",
      function: {
        name: "google_macro_search",
        description: "【宏观定量数据引擎】当需要获取具体的宏观经济数字时调用！🚨 严厉警告：此工具是搜索引擎，不是数据库！仅限用于查询【今天此时此刻】的单个最新数值。绝对禁止用它来搜索“历史走势”、“X月到X月的数据”，否则你会引发死循环！🚨 致命警告：受搜索引擎缓存影响，若第一次查到的数据是昨天或前天的，请【直接使用该数据并停止重搜】，只需向用户说明数据更新日期即可，严禁陷入无限重复调用的死循环！🚨 致命红线：绝对禁止用此工具搜索【6位数代码的公募基金】的净值！查公募基金必须且只能调用 get_realtime_fund_data 或 get_fund_history_data！",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            timeRange: { type: "string", enum: ["qdr:d", "qdr:w", "qdr:m", "all"], description: "搜索时间范围：qdr:d(过去24小时), qdr:w(过去一周), qdr:m(过去一月), all(不限)。默认请用 qdr:d" }
          },
          required: ["query"]
        }
      }
    });
  }

  // 🔫 武器3：基金历史数据
  tools.push({
    type: "function",
    function: {
      name: "get_fund_history_data",
      description: "【基金时序数据库】专门用于获取公募基金过去 30 个交易日的历史净值序列。当用户要求查净值、看某只基金走势、画基金图表时，必须优先调用此工具获取底层数据数组。",
      parameters: { type: "object", properties: { fundCode: { type: "string" } }, required: ["fundCode"] }
    }
  });

  // 🔫 武器4：新闻事件聚合器 (Tavily)
  if (settings.tavilyApiKey) {
    tools.push({
      type: "function",
      function: {
        name: "tavily_news_search",
        description: "【定性新闻事件引擎】仅用于查询大盘异动原因、突发新闻、宏观政策解读等文字类信息。🚨 绝对禁止用此工具查询国债收益率等具体数字！",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "例如：'今日 A股 暴跌 核心原因'" },
            recency: { type: "string", enum: ["d1", "d3", "w1"], description: "新闻新鲜度要求：d1(24小时内极速快讯), d3(最近3天), w1(最近一周)。查暴跌原因用 d1" }
          },
          required: ["query"]
        }
      }
    });
  }

  // 🔫 武器5：深度研报挖掘机 (Exa)
  if (settings.exaApiKey) {
    tools.push({
      type: "function",
      function: {
        name: "exa_research",
        description: "【深度长文研报引擎】当需要深挖特定资产的长期宏观逻辑、机构长篇定性研报、重大会议深入解读时调用。适合用于了解未来的中长期趋势分析！注意：绝对禁止用于查单日净值或实时报价。🚨 致命警告：各大基金公司的官方季报多为纯图片或加密 PDF 格式，搜索引擎极易卡死或读出乱码！因此，请优先在查询词中追加 '天天基金'、'新浪财经'、'持仓明细' 等关键词，强制搜索引擎去抓取【网页版/文字版的第三方解读文章】！",
        parameters: { type: "object", properties: { query: { type: "string", description: "例如：'创金合信中证红利低波动指数A 天天基金 最新一季报 行业分布 解读'" } }, required: ["query"] }
      }
    });
  }

  // 🔫 武器6：批量交易记账引擎
  tools.push({
    type: "function",
    function: {
      name: "update_ledger",
      description: "【批量交易引擎】当用户明确表示已经买入、卖出某只基金，或要求补录历史交易时调用此工具。支持一次性传入多条记账指令！",
      parameters: {
        type: "object",
        properties: {
          actions: {
            type: "array",
            description: "要执行的记账指令数组",
            items: {
              type: "object",
              properties: {
                fundCode: { type: "string", description: "基金6位数代码" },
                fundName: { type: "string" },
                amount: { type: "number", description: "交易金额" },
                actionType: { type: "string", enum: ["buy", "sell", "delete"] },
                date: { type: "string", description: "交易发生的具体日期，格式 YYYY-MM-DD。" }
              },
              required: ["fundCode", "amount", "actionType"]
            }
          }
        },
        required: ["actions"]
      }
    }
  });

  // 🔫 武器7：动态画图技能（原武器8）
  tools.push({
    type: "function",
    function: {
      name: "generate_trend_chart",
      description: "【可视化超能力】绘制复杂金融图表。支持多基金净值/收益率对比、击球区色带、水平关键位辅助线、双Y轴、散点图、面积图。每个数据集可独立指定颜色(line: red / green / blue / orange / purple / yellow / cyan / pink / teal / indigo / amber / lime / rose / slate)或直接给 hex 色码(#rrggbb)。多基金对比线图会自动归一化为累积涨跌幅%方便比较。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "图表标题" },
          chartType: { type: "string", enum: ["line", "bar", "area", "scatter"], description: "图表主类型。area=填充面积图, scatter=散点图" },
          labels: { type: "array", items: { type: "string" }, description: "X轴时间标签" },
          enableDualAxis: { type: "boolean", description: "是否启用双Y轴(左右各一)。当不同数据集量纲差异极大时(如价格vs涨跌幅%)应设为 true，并在各数据集中用 yAxisIndex 指定归属轴" },
          datasets: {
            type: "array",
            description: "多基金/指标数据序列。每个数据集可独立控制颜色、线型、填充、点可见性和所属Y轴。",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "图例标签，如 '易方达蓝筹精选'" },
                data: { type: "array", items: { type: "number" }, description: "数据值数组" },
                color: { type: "string", description: "数据集颜色名称(red/green/blue/orange/purple/yellow/cyan/pink/teal/indigo/amber/lime/rose/slate) 或 hex 色码(#rrggbb)。不填则自动按顺序分配主题色" },
                fill: { type: "boolean", description: "是否填充线条下方区域(面积图效果)，默认 false" },
                dashed: { type: "boolean", description: "是否使用虚线绘制，默认 false" },
                showPoints: { type: "boolean", description: "是否显示数据点圆圈标记，默认数据点<=30时显示" },
                yAxisIndex: { type: "number", enum: [0, 1], description: "所属Y轴: 0=左轴(默认), 1=右轴。仅在 enableDualAxis=true 时生效" },
                chartType: { type: "string", enum: ["line", "bar", "area", "scatter"], description: "该数据集的独立图表类型(覆盖全局 chartType)，用于混合图表" }
              },
              required: ["label", "data"]
            }
          },
          horizontalLines: {
            type: "array",
            description: "水平辅助线(如支撑位、阻力位、击球区边界、成本线)。颜色不填则用线色+半透明背景标注。",
            items: {
              type: "object",
              properties: {
                value: { type: "number" },
                color: { type: "string", description: "颜色名或 hex 色码" },
                label: { type: "string", description: "该线的文字标注(显示在图例中)" },
                dashed: { type: "boolean", description: "是否虚线，默认 true" }
              },
              required: ["value"]
            }
          },
          horizontalBands: {
            type: "array",
            description: "水平半透明色带(如击球区、估值带、超买超卖区)。每个色带自动以半透明色块显示在图表背景中。",
            items: {
              type: "object",
              properties: {
                yMin: { type: "number", description: "色带下边界值" },
                yMax: { type: "number", description: "色带上边界值" },
                color: { type: "string", description: "颜色名或 hex 色码，如 'green'(击球区底部) 或 '#10b981'" },
                label: { type: "string", description: "色带的文字标注(显示在图例中)" }
              },
              required: ["yMin", "yMax"]
            }
          }
        },
        required: ["title", "chartType", "labels", "datasets"]
      }
    }
  });

  // 🔫 武器8：JS 代码沙盒
  tools.push({
    type: "function",
    function: {
      name: "execute_javascript",
      description: "【全能量化数学引擎】LLM不擅长精确计算！当你需要进行：复利终值、所需收益率倒算、最大回撤(MDD)、相关性分析、波动率/夏普比率、或任何财务数学时，【绝对禁止】脑中盲猜！请编写 JS 代码通过 return 返回精确结果。支持 Math 标准库。注意：代码必须以 return 语句结束。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "合法的 JS 代码。例如计算复利：'let p=80000; let r=0.035/12; let m=7; return p*Math.pow(1+r,m);'" },
          reasoning: { type: "string", description: "一句话解释你为什么要写这段代码（供审计使用）" }
        },
        required: ["code", "reasoning"]
      }
    }
  });

  // 🔫 武器9：批量基金数据
  tools.push({
    type: "function",
    function: {
      name: "get_batch_fund_data",
      description: "【批量金融API】当需要同时查询多只基金的最新净值和表现时，绝对优先调用此批量接口，禁止使用单只查询！",
      parameters: {
        type: "object",
        properties: { fundCodes: { type: "array", items: { type: "string" }, description: "基金6位数代码数组，最多15只", maxItems: 15 } },
        required: ["fundCodes"]
      }
    }
  });

  // 🔫 武器10：待办全生命周期管理引擎
  tools.push({
    type: "function",
    function: {
      name: "manage_plan_todo",
      description: "【待办计划管理引擎】🚨 致命纪律：当需要新增、顺延(修改)、删除(取消)交易计划时，【必须且只能】调用此工具！禁止使用'明天'、'后天'、'下周一'等没有具体日期的描述，必须使用绝对日期。绝对禁止用纯文字敷衍用户说'已添加待办'而不触发此工具！如果要操作已存在的计划，必须传入其 待办ID。",
      parameters: {
        type: "object",
        properties: {
          plans: {
            type: "array",
            description: "待办计划指令数组",
            items: {
              type: "object",
              properties: {
                manageType: { type: "string", enum: ["add", "update", "delete"] },
                id: { type: "string", description: "【更新或删除时极其重要】必须填写上下文中方括号里的纯粹的字母数字ID" },
                fundCode: { type: "string", description: "【新增时必填】基金6位数代码" },
                fundName: { type: "string", description: "【新增时必填】基金名称" },
                tradeDirection: { type: "string", enum: ["buy", "sell", "observe"] },
                amount: { type: "number", description: "计划交易金额" },
                condition: { type: "string", description: "【新增或更新时必填】触发条件" },
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

  // 🔫 武器11：AI 长期记忆写入引擎
  tools.push({
    type: "function",
    function: {
      name: "update_decision_memo",
      description: "【战略备忘录记录与自我更新】用于记录或覆写长线定调。🚨 写入时必须严格遵循三层物理隔离法则：\n1. target='GLOBAL_CONSTITUTION'：仅在此写入用户的【绝对收益目标】、【总资产规模】等静态财富宪法。\n2. target='GLOBAL_MARKET'：仅在此写入【10年国债极值】、【A股流动性阈值分水岭】等动态宏观锚点。\n3. target='具体基金代码'：必须极度精简！【绝对禁止】在个基备忘录中写宏观分析，只能标明该基金的【身份】以及【数学纪律】。需要写入日期时，禁止使用'明天'、'后天'、'下周一'等没有具体日期的描述，必须使用绝对日期如5-28/5.28/5月28",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "标的代码。注意：如果是大盘定调请写 GLOBAL_CONSTITUTION 或 GLOBAL_MARKET。" },
          targetName: { type: "string", description: "标的名称或大盘标签" },
          decisionType: { type: "string", enum: ["BUY_STRATEGY", "HOLD_STRATEGY", "BLACK_LIST", "WATCH_GRID", "GLOBAL_MACRO"] },
          coreLogic: { type: "string", description: "核心逻辑摘要，字数尽量精简" }
        },
        required: ["target", "targetName", "decisionType", "coreLogic"]
      }
    }
  });

  // 🔫 武器12：FOF 穿透字典采编引擎
  tools.push({
    type: "function",
    function: {
      name: "update_fof_dictionary",
      description: "【资产穿透字典采编】当调用 get_fund_holdings_penetration 或者 exa_research 获取了底层重仓股数据，并在脑海中推算出真实权益仓位与申万行业分布后，调用此工具将结果写入云端X-Ray字典。🚨 数据必须真实客观！纯债/货币基金严禁入库！",
      parameters: {
        type: "object",
        properties: {
          fundCode: { type: "string", description: "基金代码" },
          fundName: { type: "string", description: "基金名称" },
          equityRatio: { type: "number", description: "真实股票仓位比例（例如 85% 填 0.85）" },
          sectors: {
            type: "object",
            description: "申万一级或核心行业分布比例的键值对。确保加起来约等于 1.0。例如: {'电子/半导体': 0.4, '医药生物': 0.3, '新能源': 0.3}",
            additionalProperties: { type: "number" }
          }
        },
        required: ["fundCode", "fundName", "equityRatio", "sectors"]
      }
    }
  });

  // 🔫 武器13：底层持仓穿透引擎
  tools.push({
    type: "function",
    function: {
      name: "get_fund_holdings_penetration",
      description: "【底层持仓穿透引擎】当需要获取基金的【前十大重仓股】以更新 FOF 字典时，🚨绝对优先调用此接口！严禁去外网搜 PDF！拿到重仓股明细后，请你发挥常识，将这些股票归类到申万一级行业，并估算大致的股票仓位，最后调用 update_fof_dictionary 入库。",
      parameters: { type: "object", properties: { fundCode: { type: "string" } }, required: ["fundCode"] }
    }
  });

  // 🔫 武器14：历史K线深度溯源探针
  tools.push({
    type: "function",
    function: {
      name: "get_market_historical_intraday",
      description: "【历史K线深度透视眼】当你需要复盘大盘近期走势、量价杀跌博弈时调用。它将调取过去20个交易日的精确OHLC（开盘/最高/最低/收盘）数据及上下影线形态。",
      parameters: {
        type: "object",
        properties: { code: { type: "string", description: "指数或ETF代码，如 sh000001 (上证), sh511260 (国债ETF)" } },
        required: ["code"]
      }
    }
  });

  return tools;
};
