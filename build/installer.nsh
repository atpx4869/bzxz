; 标准盒子 NSIS 自定义安装/卸载脚本
; 卸载/升级时保留资质数据库 ($INSTDIR\data)
;
; 行为：
;   - 升级（electron-builder 静默调用旧版卸载器）：始终保留 data/
;   - 交互卸载：弹窗询问，默认保留
;   - 命令行 /S 静默卸载：按 /SD 默认（保留）

!macro customUnInit
  ; 默认保留（升级时静默路径会直接走这里）
  StrCpy $R0 "1"

  ; 没有 data 目录就没必要继续
  IfFileExists "$INSTDIR\data\*.*" 0 skip_prompt

  ; 静默卸载（升级或 /S）保持默认"保留"
  IfSilent skip_prompt 0

  MessageBox MB_YESNO|MB_ICONQUESTION \
    "是否保留资质数据？$\r$\n$\r$\n保留后，下次重新安装到同一目录可继续使用已订阅标准、CNAS / CMA 缓存等数据。$\r$\n$\r$\n选择“否”将彻底删除 $INSTDIR\data 目录。" \
    /SD IDYES IDYES skip_prompt IDNO drop_data

  drop_data:
    StrCpy $R0 "0"

  skip_prompt:
!macroend

!macro customRemoveFiles
  ; 若需保留 data：先把 data 移到上级临时目录，等 NSIS 清完安装目录后再移回
  StrCmp $R0 "1" 0 normal_remove

  ; 同名残留时先清掉，避免 Rename 失败
  IfFileExists "$INSTDIR\..\._bzxz_data_backup\*.*" 0 +2
    RMDir /r "$IN