# DNSSEC 監控

DNSSEC 監控讓您驗證各區域 DNS 回應的密碼學完整性。OneUptime 會定期執行完整的 DNSSEC 驗證——檢查 DNSKEY 記錄、父區域的 DS 委派、RRSIG 簽章有效性、解析器對 AD 旗標的共識，以及各權威名稱伺服器之間的一致性。

## 概觀

DNSSEC 監控會驗證從根區域往下到您網域的整條信任鏈。這讓您能夠：

- 在解析器開始對使用者回傳 SERVFAIL 之前，偵測已損壞的 DNSSEC 信任鏈
- 在區域簽署金鑰過期之前收到警告
- 驗證您的 DS 記錄是否已正確發佈於父區域
- 捕捉各權威名稱伺服器之間的分歧（主要／次要伺服器不同步）
- 確認驗證型解析器確實為您的區域設定了 AD 旗標

## 建立 DNSSEC 監控

1. 前往 OneUptime 儀表板中的 **Monitors**
2. 點選 **Create Monitor**
3. 選擇 **DNSSEC** 作為監控類型
4. 輸入您想驗證的區域（網域）
5. 視需要設定解析器與監控條件

## 設定選項

### 基本設定

| 欄位                         | 說明                                                                     | 必填 |
| ---------------------------- | ------------------------------------------------------------------------ | ---- |
| Zone (Domain Name)           | 要透過 DNSSEC 驗證的區域（例如 `example.com`）                           | 是   |
| Resolvers                    | 要查詢的驗證型解析器清單，以逗號分隔（例如 `1.1.1.1, 8.8.8.8, 9.9.9.9`） | 是   |
| Check Nameserver Consistency | 直接查詢每個權威名稱伺服器，並驗證它們是否回傳相同的 SOA 序號            | 否   |

### 進階設定

| 欄位                            | 說明                       | 預設值 |
| ------------------------------- | -------------------------- | ------ |
| Signature Expiry Warning (days) | RRSIG 過期過濾器的預設門檻 | 7      |
| Timeout (ms)                    | 每個 DNS 查詢的等待時間    | 10000  |
| Retries                         | 失敗時的重試次數           | 3      |

## 監控條件

您可以設定條件，以根據下列項目判斷您的區域處於上線、降級或離線狀態：

### 可用的檢查類型

| 檢查類型                            | 說明                                                  |
| ----------------------------------- | ----------------------------------------------------- |
| DNSSEC Chain Is Valid               | 整條驗證鏈（root → TLD → zone）能正確解析             |
| DNSSEC DNSKEY Record Exists         | 該區域至少發佈一筆 DNSKEY 記錄                        |
| DNSSEC DS Record Exists At Parent   | 父區域發佈了一筆與該區域 KSK 相符的 DS 記錄           |
| DNSSEC Signature Expires In Days    | 距離最早一筆 RRSIG 簽章過期的天數                     |
| DNSSEC Resolver Consensus (AD Flag) | 每個被查詢的解析器都回傳 AD（Authenticated Data）旗標 |
| DNSSEC Nameservers Are Consistent   | 所有權威名稱伺服器都回傳相同的 SOA 序號               |
| DNSSEC Is Valid                     | 所有驗證檢查的彙總通過／失敗結果                      |

### 過濾器類型

對於 **DNSSEC Chain Is Valid**、**DNSSEC DNSKEY Record Exists**、**DNSSEC DS Record Exists At Parent**、**DNSSEC Resolver Consensus (AD Flag)**、**DNSSEC Nameservers Are Consistent** 以及 **DNSSEC Is Valid**：

- **True** — 條件為真
- **False** — 條件為假

對於 **DNSSEC Signature Expires In Days**：

- **Greater Than**、**Less Than**、**Greater Than or Equal To**、**Less Than or Equal To**、**Equal To**、**Not Equal To**

### 範例條件

#### 當 DNSSEC 信任鏈損壞時發出警示

- **Check On**：DNSSEC Chain Is Valid
- **Filter Type**：False

#### 在簽章過期前發出警告

- **Check On**：DNSSEC Signature Expires In Days
- **Filter Type**：Less Than
- **Value**：7

#### 捕捉父區域缺少 DS（委派損壞）

- **Check On**：DNSSEC DS Record Exists At Parent
- **Filter Type**：False

#### 偵測解析器不一致

- **Check On**：DNSSEC Resolver Consensus (AD Flag)
- **Filter Type**：False

#### 捕捉名稱伺服器腦裂（split-brain）

- **Check On**：DNSSEC Nameservers Are Consistent
- **Filter Type**：False

## 最佳實務

1. **使用多個公開解析器** — 預設使用 `1.1.1.1`、`8.8.8.8` 與 `9.9.9.9`，如此一來單一解析器中斷時就不會造成誤報
2. **在過期前充分提前警告** — 將降級警示設定在簽章過期前 7 天、離線警示設定在過期前 2 天；金鑰輪替可能在無聲無息中失敗
3. **監控每一個已簽署的區域** — 涵蓋頂點網域、已簽署的子網域，以及任何委派給其他營運方的區域
4. **啟用名稱伺服器一致性檢查** — 可捕捉單靠 DNSSEC 驗證會遺漏的主要／次要伺服器同步問題，除非您的網路封鎖了往外連到任意 IP 的 DNS 流量
