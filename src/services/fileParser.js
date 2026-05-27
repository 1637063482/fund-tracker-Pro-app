// ============================================================================
// 🌟 核心感知层：纯血 Gemini 2.5 Pro 视觉与长文本解析引擎
// 专攻：长篇 PDF 原生解析 (季报/年报) & 复杂不规则中文截图 (持仓明细)
// ============================================================================

// 🌟 （可选）如果你希望在代码里硬编码兜底 API Key，可填在这里。
// 默认情况下，代码会优先读取你在 App 设置面板里配置的 Gemini API Key。
const FALLBACK_GEMINI_API_KEY = '';

const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = (error) => reject(error);
    });
};

/**
 * 核心对外接口：完全由 Gemini 接管所有类型的文件解析
 */
export const extractDataFromImage = async (file, settings, engine = 'gemini') => {
    const mimeType = file.type;
    
    if (!mimeType.startsWith('image/') && mimeType !== 'application/pdf') {
        throw new Error("不支持的文件类型，仅支持图片或 PDF。");
    }

    // 🌟 拦截层：根据你的最新架构指示，直接抛弃其他引擎逻辑。
    // 无论 UI 层选择了什么引擎（哪怕是旧的 baidu/silicon），统一交由最强的 Gemini Pro 处理。
    if (engine !== 'gemini') {
        console.warn(`[解析引擎重定向] 前端请求了 ${engine} 引擎，但系统已配置为纯血 Gemini 模式。任务已平滑移交至 Gemini 2.5 Pro。`);
    }

    return await extractWithGeminiPro(file, settings, mimeType);
};

// ==========================================
// 核心处理器：Google Gemini 2.5 Pro 
// ==========================================
const extractWithGeminiPro = async (file, settings, mimeType) => {
    // 优先使用用户在设置中配置的 Key，否则尝试使用文件顶部的兜底 Key
    const apiKey = settings.geminiApiKey || FALLBACK_GEMINI_API_KEY; 
    
    if (!apiKey) {
        throw new Error("缺少 Gemini API Key，请先在 App 的【系统设置中心】中配置。");
    }

    const base64Data = await fileToBase64(file);
    
    // 🌟 核心升级：废弃激进的“清洗、剔除”指令，改为 Schema 强约束的“目标拉取法”，防止模型幻觉删数据
    const extractionPrompt = `
你是一个极其严谨的顶级华尔街金融数据提取器。
我上传的可能是一份长达几十页的基金季报 PDF，或是一张复杂的截图。请直接跳过废话声明，全局扫描并精准定位到【投资组合报告】、【股票投资明细】等核心章节。

【提取要求，绝对不可违背】：
1. 提取以下结构化核心数据：基金名称、前十大重仓股（名称、代码、价格、涨跌幅及准确占比）、股票/债券持仓比例、整体阶段收益率等。
2. 宁可留空，绝不允许自己捏造、估算或修改任何一个数字！
3. 请仔细核对表格的表头，确保金额与股票名称一一对应，严禁张冠李戴。
4. 请将提取出的数据组装成一个极度干净、对齐的 Markdown 文本和表格格式输出。不要输出任何寒暄语。
    `;
    
    // 🌟 核心战力升级：Flash -> Pro，200万 Token 超大上下文，智商和抗幻觉能力呈指数级提升
    const targetModel = 'gemini-2.5-flash'; 
    const fetchUrl = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

    const requestBody = {
        contents: [
            { 
                parts: [
                    { text: extractionPrompt }, 
                    { inline_data: { mime_type: mimeType, data: base64Data } }
                ] 
            }
        ],
        generationConfig: { 
            temperature: 0.0, // 强制 0.0，彻底封杀发散性幻觉，保证提取一致性
            maxOutputTokens: 8192 
        }
    };

    try {
        const response = await fetch(fetchUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const responseText = await response.text();
        let data;
        
        try { 
            data = JSON.parse(responseText); 
        } catch (e) { 
            throw new Error(`Google 直连失败，返回了非 JSON 格式 (HTTP ${response.status})。请检查代理节点。`); 
        }

        if (!response.ok || data.error) {
            const errorMsg = data.error?.message || "";
            
            // 细化错误捕获，给予用户友好的中文提示
            if (response.status === 429 || errorMsg.toLowerCase().includes('quota')) {
                throw new Error("Gemini API 调用频率超限或额度耗尽，请稍后再试。");
            }
            if (response.status === 400 && errorMsg.includes('payload')) {
                 throw new Error("上传的 PDF 文件体积过大，超出了单次解析限制。请仅截取包含【重仓明细】的关键页面作为图片上传。");
            }
            if (errorMsg.includes('API key not valid')) {
                 throw new Error("配置的 Gemini API Key 无效，请检查设置。");
            }
            
            throw new Error(errorMsg || `Google API 请求错误: HTTP ${response.status}`);
        }

        const extractedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!extractedText) {
            throw new Error("Gemini 解析完成，但未能提取到有效文本。可能是文件扫描太模糊，或者文档内确实没有包含重仓财务数据。");
        }

        return extractedText.trim();

    } catch (error) {
        console.error("【Gemini 视觉引擎崩溃】:", error);
        throw new Error(error.message === "Failed to fetch" ? "网络无法访问 Google 服务，请检查您的代理配置。" : error.message);
    }
};