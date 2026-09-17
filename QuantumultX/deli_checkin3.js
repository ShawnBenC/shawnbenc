// ==UserScript==
// @ScriptName        得力e+ 自动打卡 3.0（全自动化 & 强制手动）
// @Author            乌蝇哥™ ( by ShawnC)
// @UpdateTime        2026-09-17
// @FixNote           v3.0 架构重构：
//                    1. 强制手动模式：@Deli.ForceRun 开关开启
//                    2. 开关全容错诊断：启动开关探测结果，消除排查盲区。
// ==/UserScript==

/*
[rewrite_local]
# 添加重写抓取打卡身份参数及定位信息 (必须使用 body 模式)
^https?:\/\/kq\.delicloud\.com\/attend\/.* url script-request-body https://raw.githubusercontent.com/ShawnBenC/shawnbenc/refs/heads/main/QuantumultX/deli_checkin3.js

[task_local]
# 早上、下午 (8点,13点的 45-55分 每分钟轮询)
45-55 8,13 * * 1-5 https://raw.githubusercontent.com/ShawnBenC/shawnbenc/refs/heads/main/QuantumultX/deli_checkin3.js, tag=得力打卡(早/下), enabled=true

# 下班时间段 (12点的 01-11分 每分钟轮询)
01-11 12 * * 1-5 https://raw.githubusercontent.com/ShawnBenC/shawnbenc/refs/heads/main/QuantumultX/deli_checkin3.js, tag=得力打卡(中午), enabled=true

# 下班时间段 (17点的 31-41分 每分钟轮询)
31-41 17 * * 1-5 https://raw.githubusercontent.com/ShawnBenC/shawnbenc/refs/heads/main/QuantumultX/deli_checkin3.js, tag=得力打卡(晚退), enabled=true

[MITM]
hostname = kq.delicloud.com
*/

const $ = new Env("得力e+打卡");

// 对应 BoxJS 里的 Keys
const KEY_ACCOUNT = "Deli.Account";

if (typeof $request !== "undefined") {
    // ======== 抓包重写逻辑 (触发条件：打开App进入考勤页) ========
    captureData();
} else {
    // ======== 打卡任务逻辑 (触发条件：Cron定时器或手动运行) ========
    console.log("================== 得力打卡任务 ==================");
    doCheckin();
}

function captureData() {
    try {
        const url = $request.url;
        const headers = $request.headers;
        const body = $request.body; // 获取请求体用于提取坐标

        if (!headers) return;

        // 兼容键值大小写
        const getHeader = (key) => headers[key] || headers[key.toLowerCase()] || headers[key.toUpperCase()];
        const token = getHeader("token");
        const cookie = getHeader("Cookie");
        const uuid = getHeader("uuid");

        // 1. 抓取账号凭证 (Token等)
        if (url.indexOf("kq.delicloud.com") > -1 && token && cookie && uuid) {
            const account = {
                token: token, cookie: cookie, uuid: uuid,
                v1_member_id: getHeader("v1_member_id"),
                user_id: getHeader("user_id"),
                org_id: getHeader("org_id")
            };
            
            // 尝试读取旧数据，防止重复弹窗打扰
            let isChanged = true;
            const oldAccountStr = $.getdata(KEY_ACCOUNT);
            if (oldAccountStr) {
                try {
                    if (JSON.parse(oldAccountStr).token === token) isChanged = false;
                } catch (e) {}
            }

            if (isChanged) {
                $.setdata(JSON.stringify(account), KEY_ACCOUNT);
                $.msg($.name, "✅ 账号凭证抓取成功", "最新 Token 及 Cookie 已保存至 BoxJS。");
            }
        }

        // 2. 抓取真实打卡定位与设备参数 (核心优化)
        if (url.indexOf("/attend/check/check") > -1 && body) {
            try {
                const reqBody = JSON.parse(body);
                if (reqBody.lng && reqBody.lat) {
                    // 读取旧坐标对比，避免重复弹窗
                    let isLocChanged = false;
                    if ($.getdata("Deli.Lng") !== String(reqBody.lng)) {
                        $.setdata(String(reqBody.lng), "Deli.Lng");
                        isLocChanged = true;
                    }
                    if ($.getdata("Deli.Lat") !== String(reqBody.lat)) {
                        $.setdata(String(reqBody.lat), "Deli.Lat");
                        isLocChanged = true;
                    }
                    // 同步更新其他静态信息
                    if (reqBody.address) $.setdata(reqBody.address, "Deli.Address");
                    if (reqBody.name) $.setdata(reqBody.name, "Deli.Name");
                    if (reqBody.device_id) $.setdata(String(reqBody.device_id), "Deli.DeviceId");

                    if (isLocChanged) {
                        $.msg($.name, "📍 定位参数抓取成功", "已同步更新至 BoxJS。");
                    }
                }
            } catch (e) {
                console.log("[得力打卡] 解析打卡请求体失败");
            }
        }
    } catch (e) {
        console.log(`[得力打卡] 抓包处理异常: ${e}`);
    } finally {
        $.done({});
    }
}

function doCheckin() {
    const accountStr = $.getdata(KEY_ACCOUNT);
    if (!accountStr) {
        $.msg($.name, "❌ 未找到账号凭证", "请先运行重写并进入得力e+考勤页面获取。");
        return $.done();
    }

    let acc = {};
    try { acc = JSON.parse(accountStr); } catch (e) { return $.done(); }

    // 从 BoxJS 读取定位参数
    const lng = $.getdata("Deli.Lng");
    const lat = $.getdata("Deli.Lat");
    const address = $.getdata("Deli.Address");
    const name = $.getdata("Deli.Name");
    const deviceId = $.getdata("Deli.DeviceId");

    if (!lng || !lat || !deviceId) {
        $.msg($.name, "❌ 缺少定位或设备数据", "请在 App 内手动执行一次打卡，脚本将自动抓取并保存。");
        return $.done();
    }

    // 账号唯一标识（防重隔离）
    const accountId = acc.user_id || acc.uuid || "default";

    // =========================================================================
    // 🔑 检测 BoxJS 强制手动模式（@Deli.ForceRun）
    // 兼容所有键名与存储类型 (boolean, string, number 等)
    // =========================================================================
    const forceRunKeys = ["@Deli.ForceRun", "Deli.ForceRun", "@DeliCheckin.ForceRun", "DeliCheckin.ForceRun"];
    let forceRunRaw = null;
    let matchedKey = "无";
    for (const k of forceRunKeys) {
        const v = $.getdata(k);
        if (v !== null && v !== undefined && v !== "") {
            forceRunRaw = v;
            matchedKey = k;
            break;
        }
    }

    // 宽容解析：兼容 true, "true", 1, "1", "yes", "on"
    let isForceRun = false;
    if (forceRunRaw === true || forceRunRaw === 1) {
        isForceRun = true;
    } else if (typeof forceRunRaw === "string") {
        const s = forceRunRaw.trim().toLowerCase();
        isForceRun = (s === "true" || s === "1" || s === "yes" || s === "on");
    }

    // 排查日志
    console.log(`[得力打卡] 🔍 模式诊断: 强制开关=[${isForceRun ? '已开启(ON)' : '已关闭(OFF)'}] (匹配键名: ${matchedKey}, 原始值: ${JSON.stringify(forceRunRaw)})`);

    // =========================================================================
    // 🚀 分支 A：【强制手动模式】（isForceRun === true）
    // =========================================================================
    if (isForceRun) {
        console.log(`[得力打卡] 🔑 进入【强制手动模式】：无视时段、无视防重锁定、跳过随机概率，直接执行打卡！`);
        console.log(`[得力打卡] ⚠️ 提示：请确保已在 QX 中停用定时轮询任务，否则定时任务触发时也会无条件打卡。`);
        // 短延迟 1~2 秒
        const delaySec = Math.floor(Math.random() * 2) + 1;
        executeRequest(acc, lng, lat, address, name, deviceId, accountId, delaySec, "强制手动", null);
        return;
    }

    // =========================================================================
    // 🛡️ 分支 B：【全自动日常模式】（isForceRun === false）
    // 设计定位：日常上下班自动化打卡，防重机制全面生效。
    // =========================================================================
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    const hour = now.getHours();
    const minute = now.getMinutes();

    // 班次时段划定
    let shiftTag = "unknown";
    if (hour >= 7 && hour <= 9) shiftTag = "morning";
    else if (hour >= 11 && hour <= 12) shiftTag = "noon";
    else if (hour >= 13 && hour <= 15) shiftTag = "afternoon";
    else if (hour >= 17 && hour <= 19) shiftTag = "evening";
    else shiftTag = `hour_${hour}`;

    // 定时轮询时间窗口定义（与 task_local 保持一致）
    const isInScheduledWindow =
        (hour === 8  && minute >= 45 && minute <= 55) ||
        (hour === 13 && minute >= 45 && minute <= 55) ||
        (hour === 12 && minute >= 1  && minute <= 11) ||
        (hour === 17 && minute >= 31 && minute <= 41);

    // 防重标记 Key（账号隔离）
    const flagKey = `Deli_Checkin_${accountId}_${dateStr}_${shiftTag}`;
    const hasCheckedIn = $.getdata(flagKey);

    console.log(`[得力打卡] 🕒 当前时间: ${hour}:${minute >= 10 ? minute : '0' + minute} | 班次: [${shiftTag}] | 防重状态: [${hasCheckedIn === 'true' ? '今日已打卡' : '今日未打卡'}]`);

    // -------------------------------------------------------------------------
    // B1：时间窗口外（普通手动运行）
    // -------------------------------------------------------------------------
    if (!isInScheduledWindow) {
        console.log(`[得力打卡] 🖐️ 时间窗口外运行：跳过 10% 随机概率，直接执行打卡。`);
        if (hasCheckedIn === "true") {
            console.log(`[得力打卡] ⚠️ 提示：本班次先前已有打卡记录，手动触发将忽略防重，强制执行。`);
        }
        const delaySec = Math.floor(Math.random() * 3) + 1; // 1~3秒短延迟
        // 窗口外手动打卡成功后，写入防重标记，避免随后的定时任务重复打卡
        executeRequest(acc, lng, lat, address, name, deviceId, accountId, delaySec, "窗口外手动", flagKey);
        return;
    }

    // -------------------------------------------------------------------------
    // B2：时间窗口内（Cron 定时轮询任务）
    // -------------------------------------------------------------------------
    if (hasCheckedIn === "true") {
        console.log(`[得力打卡] 🛡️ 【拦截】账号 [${accountId}] 班次 [${shiftTag}] 今日已打卡成功，退出本次轮询。`);
        return finishTask();
    }

    // 风控核心：10% 随机概率
    let isRandomHit = Math.random() < 0.1;
    let isBackupHit = false;

    // 末尾保底触发机制
    if ((hour === 8 && minute >= 54) ||
        (hour === 12 && minute >= 11) ||
        (hour === 13 && minute >= 54) ||
        (hour === 17 && minute >= 41)) {
        isBackupHit = true;
    }

    if (isBackupHit && !isRandomHit) {
        console.log(`[得力打卡] 随机未命中，触发末尾保底机制强制打卡！`);
    } else {
        console.log(`[得力打卡] 随机触发结果: ${isRandomHit || isBackupHit}`);
    }

    if (!isRandomHit && !isBackupHit) {
        console.log(`[得力打卡] 🎲 随机未命中，等待下一分钟轮询...`);
        return finishTask();
    }

    // 定时轮询命中：5~35 秒随机延迟模拟真实人工打卡
    const delaySec = Math.floor(Math.random() * 30) + 5;
    executeRequest(acc, lng, lat, address, name, deviceId, accountId, delaySec, "定时轮询", flagKey);
}

// 统一封装请求执行函数
function executeRequest(acc, lng, lat, address, name, deviceId, accountId, delaySec, runMode, flagKeyToLock) {
    console.log(`[得力打卡] 🎯 命中打卡！[${runMode}] 账号: ${accountId}，随机延迟 ${delaySec} 秒后发送真实请求...`);

    setTimeout(() => {
        const executeTime = new Date();
        console.log(`[得力打卡] 🚀 延迟完毕 (${executeTime.toLocaleTimeString()})，发送请求... 坐标: ${lng}, ${lat}`);

        const url = "https://kq.delicloud.com/attend/check/check";
        const headers = {
            "Host": "kq.delicloud.com",
            "uuid": acc.uuid, "v1_member_id": acc.v1_member_id,
            "client_type": "eplus_app", "user_id": acc.user_id,
            "Accept": "*/*", "Accept-Language": "zh-Hans-CN;q=1, en-CN;q=0.9",
            "token": acc.token, "Content-Type": "application/json",
            "User-Agent": "smartoffice/3.3.0 (iPhone; iOS 18.7; Scale/3.00)",
            "Connection": "keep-alive", "org_id": acc.org_id, "Cookie": acc.cookie
        };

        const body = {
            "address": address, "name": name, "device_id": deviceId,
            "lng": parseFloat(lng), "device_type": "0",
            "lat": parseFloat(lat), "type": "amap"
        };

        const request = { url: url, headers: headers, body: JSON.stringify(body) };

        $.post(request, (error, response, data) => {
            if (error) {
                console.log(`[得力打卡] ❌ 网络请求失败: ${error}`);
                $.msg($.name, "❌ 打卡失败", `网络请求错误: ${error}`);
            } else {
                try {
                    const res = JSON.parse(data);
                    if (res.errno === 0 || res.errmsg === "ok") {
                        console.log(`[得力打卡] 🎉 打卡成功！响应: ${data}`);

                        // 只有提供 flagKeyToLock (即非强制模式) 才写入防重标记！
                        if (flagKeyToLock) {
                            $.setdata("true", flagKeyToLock);
                            console.log(`[得力打卡] 🔒 已写入防重标记: ${flagKeyToLock} = true`);
                        } else {
                            console.log(`[得力打卡] 🔑 强制手动模式：不写入防重标记，保持定时环境纯净。`);
                        }

                        const timeStr = `${executeTime.getHours()}:${String(executeTime.getMinutes()).padStart(2, '0')}:${String(executeTime.getSeconds()).padStart(2, '0')}`;
                        $.msg($.name, "🎉 打卡成功", `打卡时间: ${timeStr}\n打卡地点: ${address}`);
                    } else {
                        const errMsg = res.errmsg || "未知错误";
                        console.log(`[得力打卡] ⚠️ 服务端提示: ${errMsg} (errno: ${res.errno})`);
                        $.msg($.name, "⚠️ 打卡未成功", `服务端提示: ${errMsg}`);
                    }
                } catch (e) {
                    console.log(`[得力打卡] ❌ 响应解析失败: ${data}`);
                    $.msg($.name, "❌ 响应解析失败", `原始返回: ${data}`);
                }
            }
            finishTask();
        });
    }, delaySec * 1000);
}

// 统一退出函数
function finishTask() {
    console.log("===================== END =====================\n");
    $.done();
}

// -----------------------------------------------------
// 简单的 QX Env 兼容运行环境
// -----------------------------------------------------
function Env(name) {
    this.name = name; this.isQX = typeof $task !== "undefined";
    this.getdata = (key) => this.isQX ? $prefs.valueForKey(key) : null;
    this.setdata = (val, key) => this.isQX ? $prefs.setValueForKey(val, key) : false;
    this.msg = (title, subtitle, body) => { if(this.isQX) $notify(title, subtitle, body); };
    this.post = (opts, cb) => {
        if (this.isQX) {
            if (typeof opts == "string") opts = { url: opts };
            opts.method = "POST";
            $task.fetch(opts).then(r => { r.status = r.statusCode; cb(null, r, r.body); }, e => cb(e.error, null, null));
        }
    };
    this.done = (val = {}) => { if (typeof $done !== "undefined") $done(val); };
}
