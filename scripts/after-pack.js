// Puts the One Focus icon into the Windows .exe without needing Wine
// (electron-builder's own icon step needs Wine when building on Linux/macOS).
const fs = require('fs');
const path = require('path');
const ResEdit = require('resedit');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const exePath = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const target = groups[0] || { id: 1, lang: 1033 };
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, target.id, target.lang, ico.icons.map((i) => i.data));
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
};
