# Pawprint 硬件接入说明

供硬件组对接心率、皮肤温度、步数及估算睡眠。当前交付为网站后端与上传协议；实体设备尚未接入，硬件采样、联网与端到端实机验证需在设备完成后进行。

## 1. 上传地址

```text
POST https://pawprint-health.zipeiweng453524.chatgpt.site/api/v1/telemetry
```

这是 HTTPS JSON 接口。设备可直接通过 Wi-Fi 或移动网络上传；无需打开网页，也无需 ChatGPT 登录。没有独立联网能力的传感器，可由手机、电脑或网关转发。浏览器内的 Bluetooth 配对与这个云端上传接口是两条独立链路。

## 2. 获取设备密钥

1. 宠物主人登录 Pawprint，打开 **Settings → Device → Connect → Hardware API**。
2. 填写 Device name，点击 Create upload key，保存该设备的 **Upload key**。
3. 将密钥安全配置到对应设备或网关中。

每台设备使用独立密钥，密钥已绑定当前账号的宠物；上传时不要传入账号 ID 或宠物 ID。服务器仅保存密钥哈希，创建后只能显示一次。正式设备密钥最长有效 180 天，Test 设备密钥不会超过对应 Test 会话的有效期。遗失、过期或泄露时，在网页撤销旧设备，再创建新的设备密钥。不要把密钥提交到 Git、写进公开网页、截图或日志。

每次请求携带：

```http
Authorization: Bearer YOUR_DEVICE_UPLOAD_TOKEN
Content-Type: application/json
```

常规账号的上传保存为设备数据。Test 账号的上传始终标为测试数据，不会被当作真实监测结果。先用 Test 账号联调，再为正式宠物账号创建独立设备密钥。

## 3. 一次上传一条记录

以下仅为格式示例；实际发送时使用当前 UTC 时间及新的采样 ID。

```json
{
  "sampleId": "collar-001-000042",
  "recordedAt": "2026-11-14T01:00:00.000Z",
  "heartBpm": 82,
  "skinTemperatureC": 34.6,
  "stepsToday": 6248,
  "estimatedSleepHoursToday": 7.7
}
```

| 字段 | 类型与范围 | 含义 |
|---|---|---|
| `sampleId` | 必填字符串，1–96 个字符；仅字母、数字及 `._:-` | 该设备本次采样的唯一 ID。重试时保持不变。 |
| `recordedAt` | 必填字符串，UTC ISO 8601，以 `Z` 结尾 | 采样时间，不是上传时间。最多补传过去 30 天的数据，允许最多 5 分钟的时钟超前。 |
| `heartBpm` | 可选数字，0–400 | 心率，单位 bpm。 |
| `skinTemperatureC` | 可选数字，−20–60 | 皮肤温度，单位 °C；不是核心体温。 |
| `stepsToday` | 可选整数，0–1,000,000 | UTC 当天自 00:00 起的累计步数；不是本次新增步数。 |
| `estimatedSleepHoursToday` | 可选数字，0–24 | UTC 当天自 00:00 起的累计估算睡眠小时数。 |

四项指标至少提供一项有效数字。尚未测量的指标直接省略；接口也将 `null` 视为缺失。不要用 `0`、空字符串或猜测值填补缺失数据；真实测量值为零时可以上传数值 `0`。数字不能写成字符串，不要添加协议以外的字段。上面的范围仅为接口校验范围，不是健康参考区间。

单次请求最多 **4,096 字节**，每台设备最多 **120 次请求／分钟**。建议先按每分钟一次联调，再根据采样方案设置上传频率。离线队列也需遵守限流。

**日期约定：** 所有累计量按 UTC 日期归属，UTC 午夜重置。睡眠跨午夜时分别计入两天。设备需要校准时钟；离线重传保留原采样时间。

## 4. 可运行的测试请求

在电脑终端设置设备密钥（实际值不要提交到代码仓库）：

```bash
export PAWPRINT_DEVICE_TOKEN='粘贴该设备的 Upload key'
```

生成一次测试采样文件，然后用 curl 上传。若需重试，重新运行 curl，保留同一个文件：

```bash
python3 - <<'PY'
import json
import uuid
from datetime import datetime, timezone

sample = {
    "sampleId": "bench-" + uuid.uuid4().hex,
    "recordedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    "heartBpm": 82,
    "skinTemperatureC": 34.6,
    "stepsToday": 6248,
    "estimatedSleepHoursToday": 7.7,
}
with open("pawprint-sample.json", "w", encoding="utf-8") as file:
    json.dump(sample, file)
PY

curl --fail-with-body --silent --show-error \
  'https://pawprint-health.zipeiweng453524.chatgpt.site/api/v1/telemetry' \
  -H "Authorization: Bearer $PAWPRINT_DEVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @pawprint-sample.json
```

线上验证：2026-11-14，curl 已完成上传、重复请求去重、读取更新和撤销密钥验证。当前测试环境中的 Python urllib 默认客户端返回了边缘防护的 HTTP 403 / 1010，因此这里仅保留已验证的 curl 上传示例。硬件组需使用固件实际的 HTTP/TLS 客户端再联调；若同样被拦截，应联系站点托管方调整 API 防护，或采用经验证的网关。不要关闭证书验证或绕过防护。

示例保留 HTTPS 证书验证。不要在硬件或网关中关闭证书校验。示例数值仅用于 Test 账号联调，正式设备应填入真实采样值。

## 5. 成功、重试与错误

首次保存返回 HTTP `201`；同一设备以相同 `sampleId` 重传相同内容返回 `200`，不会重复新增记录：

```json
{
  "accepted": 1,
  "duplicate": false,
  "sampleId": "collar-001-000042",
  "receivedAt": "2026-11-14T01:00:01.000Z"
}
```

重复请求的 `accepted` 为 `0`，`duplicate` 为 `true`。`receivedAt` 是服务器收到记录的时间。

| HTTP 状态 | 处理方式 |
|---|---|
| `200` / `201` | 已确认，移除本地待发送队列中的这一条。 |
| `400` | 检查字段、单位、类型和时间；修正原因后再发送。 |
| `401` | 密钥缺失、无效、过期或已撤销；检查并重新配置，不要持续盲目重试。 |
| `409` | 同一个采样 ID 已对应不同内容。修正 ID 生成或重试逻辑。 |
| `413` / `415` | 请求过大或内容类型错误；使用小型 `application/json` 请求。 |
| `429` | 达到限流；遵守响应中的 `Retry-After`，再重试同一条记录。 |
| `5xx` / 网络超时 | 保留原始 ID 和内容，指数退避后重试，例如 2、4、8、16 秒，最长 60 秒并加入随机抖动。 |

错误响应为 `{ "code": "…", "message": "…" }`。不能确定请求是否成功时，不要换一个采样 ID 重发，否则会失去去重保护。

## 6. 网页如何更新

上传记录保存在数据库中，网页登录后读取当前宠物的记录。页面约每 15 秒刷新，也可以手动点击 **Refresh / Sync**。新记录会更新已有指标卡和趋势图；不需要重新部署网站。

- 心率、皮肤温度趋势按 UTC 日期汇总。
- 步数及估算睡眠使用当天最新累计值，不会将重复上传的累计量相加。
- 缺少的数据保持空缺；没有数据不会显示为健康或零值。
- 连接灯表示数据链路状态，不代表宠物健康状态。生成密钥本身不等于设备已连接。
- 采集接口不自动生成医学评分、诊断或疾病预测。水球评分仍需另行验证的评估规则。

## 7. 硬件完成后的联调顺序

1. 用 Test 账号的设备密钥，通过电脑发送一条记录，检查网页数值。
2. 改变心率或累计步数，再发送一个新 ID，确认卡片及趋势图更新。
3. 重发完全相同的一条记录，确认返回 `duplicate: true`。
4. 将请求移到真实硬件或网关，验证采样、时钟、断网缓存和恢复重传。
5. 撤销测试密钥，切换到正式宠物账号创建的设备密钥，开始真实数据采集。

当前网站接口测试与实体硬件测试是两个独立阶段；本说明不代表硬件精度、续航或实机通信已通过验证。
