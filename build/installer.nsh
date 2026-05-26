; 标准盒子 NSIS 自定义安装/卸载脚本
; 卸载/升级时保留：
;   1. $INSTDIR\data           —— 资质数据库 / CNAS·CMA 缓存
;   2. $INSTDIR\standards      —— 已下载的标准 PDF 库（默认库路径 <exe 同级>\standards）
;
; 行为：
;   - 升级（electron-builder 静默调用旧版卸载器）：始终保留 data/ + standards/
;   - 交互卸载：弹窗询问数据库，standards 始终保留（PDF 体量大、清空风险高，要走显式
;     "彻底卸载"按钮 / 用户手删才合理）
;   - 命令行 /S 静默卸载：按 /SD 默认（都保留）
;
; Why standards 不弹窗：用户报告 v 升级把 G:\bzxz\standards 几十 GB 标准全删了。
; 库目录是「下次升级也想留着的资产」，跟程序文件不是一码事 —— 默认强保留。
; 想真正清掉的用户走资源管理器手删 $INSTDIR\standards 即可。

!macro customUnInit
  ; data/ 默认保留（升级时静默路径会直接走这里）
  StrCpy $R0 "1"
  ; standards/ 始终保留（不再弹窗、不接受 IDNO）
  StrCpy $R1 "1"

  ; 没有 data 目录就没必要弹询问
  IfFileExists "$INSTDIR\data\*.*" 0 skip_prompt

  ; 静默卸载（升级或 /S）保持默认"保留"
  IfSilent skip_prompt 0

  MessageBox MB_YESNO|MB_ICONQUESTION \
    "是否保留资质数据？$\r$\n$\r$\n保留后，下次重新安装到同一目录可继续使用已订阅标准、CNAS / CMA 缓存等数据。$\r$\n$\r$\n选择“否”将彻底删除 $INSTDIR\data 目录。$\r$\n$\r$\n注：已下载的标准 PDF（$INSTDIR\standards）始终保留，如需彻底清除请卸载后手动删除该目录。" \
    /SD IDYES IDYES skip_prompt IDNO drop_data

  drop_data:
    StrCpy $R0 "0"

  skip_prompt:
!macroend

!macro customRemoveFiles
  ; 思路：要保留的子目录先 Rename 到 $INSTDIR\.. 的临时占位，让 NSIS 把 $INSTDIR
  ; 整个 RMDir /r 干掉之后再 Rename 回来。同卷下 Rename 是元数据操作，几十 GB
  ; standards 也是瞬时完成、不会复制。

  ; ── 备份阶段 ──
  ; 用具名 label 而非 +N 相对跳转，免得改动时数错指令条数。
  StrCmp $R0 "1" 0 skip_backup_data
    IfFileExists "$INSTDIR\..\._bzxz_data_backup\*.*" 0 +2
      RMDir /r "$INSTDIR\..\._bzxz_data_backup"
    Rename "$INSTDIR\data" "$INSTDIR\..\._bzxz_data_backup"
  skip_backup_data:

  StrCmp $R1 "1" 0 skip_backup_standards
    IfFileExists "$INSTDIR\..\._bzxz_standards_backup\*.*" 0 +2
      RMDir /r "$INSTDIR\..\._bzxz_standards_backup"
    Rename "$INSTDIR\standards" "$INSTDIR\..\._bzxz_standards_backup"
  skip_backup_standards:

  ; ── 清安装目录 ──
  RMDir /r "$INSTDIR"
  CreateDirectory "$INSTDIR"

  ; ── 还原阶段 ──
  StrCmp $R0 "1" 0 skip_restore_data
    Rename "$INSTDIR\..\._bzxz_data_backup" "$INSTDIR\data"
  skip_restore_data:

  StrCmp $R1 "1" 0 skip_restore_standards
    Rename "$INSTDIR\..\._bzxz_standards_backup" "$INSTDIR\standards"
  skip_restore_standards:
!macroend
