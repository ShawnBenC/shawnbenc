// ==UserScript==
// @ScriptName        得力e+ 打卡（手动版）
// @Author            乌蝇哥™ ( by ShawnC)
// @UpdateTime        2026-09-17
// @FixNote           v1.0 手动专用版
// ==/UserScript==

/*
[task_local]
# 手动打卡专用任务（设定一个永远不会自动触发的时间，或设为 enabled=false）
# 专供在 QX 任务列表、桌面小组件或快捷指令中随时手动点击“运行”：
0 0 31 2 * https://raw.githubusercontent.com/ShawnBenC/shawnbenc/refs/heads/main/QuantumultX/deli_checkin3.js, tag=得力打卡(手动), enabled=false
*/

const $ = new Env("得力e+手动打卡");

// 共享读取 BoxJS 账号凭证与定位数据
const KEY_ACCOUNT = "Deli.Account";

if (typeof $request !== "undefined") {
    $.done({});
} else {
    console.log("================== 得力手动打卡任务 ==================");
    doManualCheckin();
}

function doManualCheckin() {
    const accountStr = $.getdata(KEY_ACCOUNT);
    if (!accountStr) {
        $.msg($.name, "❌ 未找到账号凭证", "请先通过得力自动脚本抓取并在 BoxJS 保存账号数据。");
        return finishTask();
    }

    let acc = {};
    try { acc = JSON.parse(accountStr); } catch (e) { return finishTask(); }

    const lng = $.getdata("Deli.Lng");
    const lat = $.getdata("Deli.Lat");
    const address = $.getdata("Deli.Address");
    const name = $.getdata("Deli.Name");
    const deviceId = $.getdata("Deli.DeviceId");

    if (!lng || !lat || !deviceId) {
        $.msg($.name, "❌ 缺少定位或设备数据", "请在 App 内手动打卡一次以抓取经纬度，或在 BoxJS 中填入。");
        return finishTask();
    }

    const accountId = acc.user_id || acc.uuid || "default";

    // 纯手动模式：跳过一切拦截逻辑
    console.log(`[得力手动打卡] 🖐️ 手动触发！账号: ${accountId}，无视时段与防重限制。`);

    // 1~2 秒极短延迟
    const delaySec = Math.floor(Math.random() * 2) + 1;
    console.log(`[得力手动打卡] 🎯 准备发送请求，延迟 ${delaySec} 秒...`);

    setTimeout(() => {
        const executeTime = new Date();
        console.log(`[得力手动打卡] 🚀 延迟完毕 (${executeTime.toLocaleTimeString()})，发送打卡请求... 坐标: ${lng}, ${lat}`);

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
                console.log(`[得力手动打卡] ❌ 网络请求失败: ${error}`);
                $.msg($.name, "❌ 打卡失败", `网络请求错误: ${error}`);
            } else {
                try {
                    const res = JSON.parse(data);
                    if (res.errno === 0 || res.errmsg === "ok") {
                        console.log(`[得力手动打卡] 🎉 打卡成功！响应: ${data}`);
                        console.log(`[得力手动打卡] 🔑 手动模式：不写入防重标记，保持自动定时环境纯净。`);

                        const timeStr = `${executeTime.getHours()}:${String(executeTime.getMinutes()).padStart(2, '0')}:${String(executeTime.getSeconds()).padStart(2, '0')}`;
                        $.msg($.name, "🎉 打卡成功", `打卡时间: ${timeStr}\n打卡地点: ${address}`);
                    } else {
                        const errMsg = res.errmsg || "未知错误";
                        console.log(`[得力手动打卡] ⚠️ 服务端提示: ${errMsg} (errno: ${res.errno})`);
                        $.msg($.name, "⚠️ 手动打卡未成功", `服务端提示: ${errMsg}`);
                    }
                } catch (e) {
                    console.log(`[得力手动打卡] ❌ 响应解析失败: ${data}`);
                    $.msg($.name, "❌ 响应解析失败", `原始返回: ${data}`);
                }
            }
            finishTask();
        });
    }, delaySec * 1000);
}

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
