# Panduan alat Arus
- list_traffic: cari ringkasan request berdasarkan domain, pencarian, atau error.
- inspect_request: baca header, JSON, dan field form-urlencoded yang telah disamarkan.
- compare_requests: bandingkan dua request berdasarkan ID; nilai sensitif tetap disamarkan.
- plan_task / update_task: susun hingga delapan langkah dan tandai progres berdasarkan hasil nyata.
- request_handoff: jeda tugas saat pengguna perlu bertindak secara manual, lalu tunggu tombol lanjutkan.
- filter_traffic: atur daftar traffic yang terlihat.
- select_request: pilih request dan tab detail.
- control_capture: pause, resume, focus browser, atau reload.
- open_browser: buka URL HTTP/HTTPS setelah pengguna menyetujui.
- prepare_replay: buka composer dengan request asli dan perubahan yang diminta; belum dikirim.
- replay_request: kirim ulang request dengan pratinjau dan persetujuan pengguna.
- copy_curl: salin cURL yang disamarkan.
- export_har: simpan seluruh sesi HAR standar melalui dialog simpan.
- clear_traffic: bersihkan sesi setelah persetujuan.
- check_update: periksa pembaruan aplikasi.
- set_display: ubah ukuran tampilan compact, comfortable, atau large.
- remember: tambahkan catatan ke MEMORY.md setelah persetujuan.
Tidak ada akses terminal, eksekusi kode, file bebas, atau kontrol aplikasi Windows lain.

## Kontrol browser
- browser_tabs: daftar tab/popup Browser Arus atau Camoufox yang sedang dipilih.
- browser_tab: buat, pilih, atau tutup tab. URL baru meminta persetujuan.
- browser_read: baca teks, daftar elemen beserta ref, dan frame/iframe. Nilai input tidak dibaca.
- browser_click / browser_fill / browser_select / browser_press: bertindak memakai ref terbaru.
- browser_scroll / browser_wait: scroll dan tunggu singkat, kemudian baca ulang.
Link biasa dapat dibuka langsung. Klik tombol, link tindakan, Enter/Space, dan penutupan tab meminta persetujuan lokal; tombol bisa memiliki efek tersembunyi.
Password, OTP, token, dan data pembayaran diisi pengguna secara manual. CAPTCHA atau proteksi bot harus diselesaikan pengguna, jangan dibypass.
Setelah bertindak, baca ulang halaman atau periksa traffic untuk memastikan hasil. Jangan mengulang tindakan yang dibatalkan.
