using System.Diagnostics;
using System.Runtime.Versioning;
using Microsoft.Win32;

namespace CullSpace.Helper;

[SupportedOSPlatform("windows")]
public static class Services
{
    public static List<DriveInfoDto> ListDrives(bool includeNetworkOptical)
    {
        var list = new List<DriveInfoDto>();
        foreach (var d in DriveInfo.GetDrives())
        {
            try
            {
                if (!d.IsReady)
                    continue;

                var isFixed = d.DriveType is DriveType.Fixed or DriveType.Removable;
                if (!includeNetworkOptical &&
                    d.DriveType is DriveType.Network or DriveType.CDRom or DriveType.Ram)
                {
                    continue;
                }

                list.Add(new DriveInfoDto
                {
                    Name = d.Name,
                    Label = string.IsNullOrWhiteSpace(d.VolumeLabel) ? d.Name : d.VolumeLabel,
                    DriveType = d.DriveType.ToString(),
                    TotalBytes = d.TotalSize,
                    FreeBytes = d.TotalFreeSpace,
                    IsFixed = isFixed,
                });
            }
            catch
            {
                // skip inaccessible
            }
        }

        return list;
    }

    public static List<FileEntryDto> ScanLargestFiles(IEnumerable<string> drives, int limit, IProgress<string>? progress = null)
    {
        var top = new SortedSet<(long Size, string Path)>(Comparer<(long Size, string Path)>.Create((a, b) =>
        {
            var c = b.Size.CompareTo(a.Size);
            return c != 0 ? c : string.Compare(a.Path, b.Path, StringComparison.OrdinalIgnoreCase);
        }));

        var skipNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Windows", "System Volume Information", "$Recycle.Bin", "Recovery", "PerfLogs",
        };

        var skipFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "hiberfil.sys", "pagefile.sys", "swapfile.sys", "DumpStack.log.tmp",
        };

        foreach (var drive in drives)
        {
            var root = Security.TryCanonicalize(drive);
            if (root is null)
                continue;

            progress?.Report($"Scanning {root}");
            try
            {
                EnumerateFilesSafe(root, skipNames, skipFiles, top, limit, progress);
            }
            catch
            {
                // continue other drives
            }
        }

        var results = new List<FileEntryDto>();
        foreach (var item in top.Take(limit))
        {
            results.Add(new FileEntryDto
            {
                Path = item.Path,
                Name = Path.GetFileName(item.Path),
                SizeBytes = item.Size,
                IsDirectory = Directory.Exists(item.Path),
            });
        }

        return results;
    }

    private static void EnumerateFilesSafe(
        string root,
        HashSet<string> skipNames,
        HashSet<string> skipFiles,
        SortedSet<(long Size, string Path)> top,
        int limit,
        IProgress<string>? progress)
    {
        var stack = new Stack<string>();
        stack.Push(root);
        var counted = 0;

        while (stack.Count > 0)
        {
            var dir = stack.Pop();
            if (Security.IsProtectedPath(dir) &&
                !string.Equals(Path.GetPathRoot(dir)?.TrimEnd('\\') + "\\", dir.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase))
            {
                // allow drive root scan but skip protected subtrees
                if (!IsDriveRoot(dir))
                    continue;
            }

            IEnumerable<string> files = Array.Empty<string>();
            IEnumerable<string> dirs = Array.Empty<string>();
            try { files = Directory.EnumerateFiles(dir); } catch { }
            try { dirs = Directory.EnumerateDirectories(dir); } catch { }

            foreach (var file in files)
            {
                try
                {
                    var name = Path.GetFileName(file);
                    if (skipFiles.Contains(name))
                        continue;
                    var info = new FileInfo(file);
                    if (!info.Exists)
                        continue;
                    InsertTop(top, info.Length, info.FullName, limit);
                    counted++;
                    if (counted % 2500 == 0)
                        progress?.Report($"Scanned {counted:N0} files…");
                }
                catch { }
            }

            foreach (var sub in dirs)
            {
                var name = Path.GetFileName(sub);
                if (skipNames.Contains(name))
                    continue;
                if (Security.IsProtectedPath(sub) && !IsDriveRoot(sub))
                    continue;
                stack.Push(sub);
            }
        }
    }

    private static bool IsDriveRoot(string path)
    {
        var root = Path.GetPathRoot(path);
        return !string.IsNullOrEmpty(root) &&
               string.Equals(Path.GetFullPath(path).TrimEnd('\\'), root.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
    }

    private static void InsertTop(SortedSet<(long Size, string Path)> top, long size, string path, int limit)
    {
        top.Add((size, path));
        while (top.Count > limit)
            top.Remove(top.Max);
    }

    public static List<AppEntryDto> ListInstalledApps()
    {
        var apps = new Dictionary<string, AppEntryDto>(StringComparer.OrdinalIgnoreCase);
        ReadUninstallKey(RegistryHive.LocalMachine, RegistryView.Registry64, apps);
        ReadUninstallKey(RegistryHive.LocalMachine, RegistryView.Registry32, apps);
        ReadUninstallKey(RegistryHive.CurrentUser, RegistryView.Default, apps);
        return apps.Values
            .Where(a => !string.IsNullOrWhiteSpace(a.Name) && !string.IsNullOrWhiteSpace(a.UninstallString))
            .OrderByDescending(a => a.EstimatedSizeBytes)
            .ThenBy(a => a.Name)
            .ToList();
    }

    private static void ReadUninstallKey(RegistryHive hive, RegistryView view, Dictionary<string, AppEntryDto> apps)
    {
        try
        {
            using var baseKey = RegistryKey.OpenBaseKey(hive, view);
            using var uninstall = baseKey.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall");
            if (uninstall is null)
                return;

            foreach (var subName in uninstall.GetSubKeyNames())
            {
                try
                {
                    using var sub = uninstall.OpenSubKey(subName);
                    if (sub is null)
                        continue;

                    var name = sub.GetValue("DisplayName") as string;
                    if (string.IsNullOrWhiteSpace(name))
                        continue;
                    if (sub.GetValue("SystemComponent") is int sc && sc == 1)
                        continue;
                    if (sub.GetValue("ParentKeyName") is string)
                        continue;

                    var uninstallString = sub.GetValue("UninstallString") as string ?? "";
                    var installLocation = sub.GetValue("InstallLocation") as string ?? "";
                    long estimated = 0;
                    if (sub.GetValue("EstimatedSize") is int kb)
                        estimated = kb * 1024L;

                    var id = $"{hive}:{view}:{subName}";
                    apps[id] = new AppEntryDto
                    {
                        Id = id,
                        Name = name.Trim(),
                        Publisher = (sub.GetValue("Publisher") as string ?? "").Trim(),
                        Version = (sub.GetValue("DisplayVersion") as string ?? "").Trim(),
                        InstallLocation = installLocation.Trim(),
                        UninstallString = uninstallString.Trim(),
                        EstimatedSizeBytes = estimated,
                        Hive = hive.ToString(),
                    };
                }
                catch { }
            }
        }
        catch { }
    }

    public static List<RelatedPathDto> FindRelatedForFile(string targetPath, IEnumerable<string> allowedDrives)
    {
        var results = new List<RelatedPathDto>();
        var canonical = Security.TryCanonicalize(targetPath);
        if (canonical is null)
            return results;

        var allowed = allowedDrives.ToList();
        void Add(string path, string reason)
        {
            var c = Security.TryCanonicalize(path);
            if (c is null)
                return;
            if (!Security.IsUnderAllowedDrives(c, allowed) && allowed.Count > 0)
                return;

            long size = 0;
            var exists = File.Exists(c) || Directory.Exists(c);
            try
            {
                if (File.Exists(c))
                    size = new FileInfo(c).Length;
                else if (Directory.Exists(c))
                    size = DirSizeSafe(c);
            }
            catch { }

            results.Add(new RelatedPathDto
            {
                Path = c,
                SizeBytes = size,
                Reason = reason,
                Exists = exists,
                Protected = Security.IsProtectedPath(c),
            });
        }

        Add(canonical, "Selected target");
        var parent = Directory.GetParent(canonical)?.FullName;
        if (!string.IsNullOrEmpty(parent) && !IsDriveRoot(parent))
        {
            // sibling files with same base name
            var baseName = Path.GetFileNameWithoutExtension(canonical);
            try
            {
                foreach (var sibling in Directory.EnumerateFileSystemEntries(parent))
                {
                    var n = Path.GetFileNameWithoutExtension(sibling);
                    if (string.Equals(n, baseName, StringComparison.OrdinalIgnoreCase) &&
                        !string.Equals(sibling, canonical, StringComparison.OrdinalIgnoreCase))
                    {
                        Add(sibling, "Same base name in parent folder");
                    }
                }
            }
            catch { }
        }

        return results
            .GroupBy(r => r.Path, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .OrderByDescending(r => r.SizeBytes)
            .ToList();
    }

    public static List<RelatedPathDto> FindRelatedForApp(AppEntryDto app, IEnumerable<string> allowedDrives)
    {
        var results = new List<RelatedPathDto>();
        var allowed = allowedDrives.ToList();
        var name = app.Name;

        void Add(string? path, string reason)
        {
            if (string.IsNullOrWhiteSpace(path))
                return;
            var c = Security.TryCanonicalize(path);
            if (c is null)
                return;
            if (allowed.Count > 0 && !Security.IsUnderAllowedDrives(c, allowed))
            {
                // AppData leftovers may be on user drive; still allow profile paths for leftovers
                var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                if (!c.StartsWith(profile, StringComparison.OrdinalIgnoreCase))
                    return;
            }

            long size = 0;
            var exists = File.Exists(c) || Directory.Exists(c);
            try
            {
                if (File.Exists(c)) size = new FileInfo(c).Length;
                else if (Directory.Exists(c)) size = DirSizeSafe(c);
            }
            catch { }

            results.Add(new RelatedPathDto
            {
                Path = c,
                SizeBytes = size,
                Reason = reason,
                Exists = exists,
                Protected = Security.IsProtectedPath(c),
            });
        }

        if (!string.IsNullOrWhiteSpace(app.InstallLocation))
            Add(app.InstallLocation, "Install location");

        var safeName = SanitizeName(name);
        var pub = SanitizeName(app.Publisher);
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), safeName),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), safeName),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), safeName),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), pub, safeName),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), pub, safeName),
        };

        foreach (var c in candidates.Where(Directory.Exists))
            Add(c, "Name-matched app data");

        return results
            .Where(r => r.Exists)
            .GroupBy(r => r.Path, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .OrderByDescending(r => r.SizeBytes)
            .ToList();
    }

    private static string SanitizeName(string name)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string(name.Where(ch => !invalid.Contains(ch)).ToArray()).Trim();
        return string.IsNullOrWhiteSpace(cleaned) ? "Unknown" : cleaned;
    }

    private static long DirSizeSafe(string dir)
    {
        long total = 0;
        try
        {
            foreach (var f in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
            {
                try { total += new FileInfo(f).Length; } catch { }
            }
        }
        catch { }
        return total;
    }

public static object DeletePaths(IEnumerable<string> paths, IEnumerable<string> allowedDrives, bool requireAdmin)
{
    var allowed = allowedDrives.ToList();
    var deleted = new List<string>();
    var failed = new List<object>();
    var pending = new List<string>();

    foreach (var raw in paths)
    {
        var path = Security.TryCanonicalize(raw);
        if (path is null)
        {
            failed.Add(new { path = raw, error = "Invalid path" });
            continue;
        }

        if (Security.IsProtectedPath(path))
        {
            failed.Add(new { path, error = "Protected path" });
            Security.Audit($"REJECT protected delete: {path}");
            continue;
        }

        if (allowed.Count > 0 && !Security.IsUnderAllowedDrives(path, allowed))
        {
            var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            if (!path.StartsWith(profile, StringComparison.OrdinalIgnoreCase))
            {
                failed.Add(new { path, error = "Outside allowed drives" });
                Security.Audit($"REJECT outside drives: {path}");
                continue;
            }
        }

        pending.Add(path);
    }

    if (requireAdmin && !Security.IsAdministrator())
    {
        return new
        {
            elevated = false,
            deleted,
            failed,
            pending,
            error = "Administrator elevation required.",
        };
    }

    foreach (var path in pending)
    {
        try
        {
            if (File.Exists(path))
            {
                File.SetAttributes(path, FileAttributes.Normal);
                File.Delete(path);
                deleted.Add(path);
                Security.Audit($"DELETED file: {path}");
            }
            else if (Directory.Exists(path))
            {
                Directory.Delete(path, recursive: true);
                deleted.Add(path);
                Security.Audit($"DELETED dir: {path}");
            }
            else
            {
                failed.Add(new { path, error = "Not found" });
            }
        }
        catch (Exception ex)
        {
            failed.Add(new { path, error = ex.Message });
            Security.Audit($"FAIL delete: {path} :: {ex.Message}");
        }
    }

    return new { elevated = Security.IsAdministrator(), deleted, failed };
}

    public static object StartUninstall(string uninstallString)
    {
        if (string.IsNullOrWhiteSpace(uninstallString))
            throw new InvalidOperationException("Missing uninstall string.");

        // Parse quoted executable + args; never invoke via cmd/powershell.
        var (file, args) = ParseCommandLine(uninstallString);
        var canonical = Security.TryCanonicalize(file);
        if (canonical is null || !File.Exists(canonical))
            throw new InvalidOperationException("Uninstaller executable not found.");

        if (Security.IsProtectedPath(canonical) &&
            !canonical.EndsWith("msiexec.exe", StringComparison.OrdinalIgnoreCase))
        {
            // msiexec is under System32; allow only msiexec for protected roots
            throw new InvalidOperationException("Uninstaller path blocked.");
        }

        var exeName = Path.GetFileName(canonical);
        var allowedExe = exeName.Equals("msiexec.exe", StringComparison.OrdinalIgnoreCase) ||
                         exeName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase);
        if (!allowedExe)
            throw new InvalidOperationException("Uninstaller type not allowed.");

        Security.Audit($"UNINSTALL start: {canonical} {args}");
        var psi = new ProcessStartInfo
        {
            FileName = canonical,
            Arguments = args,
            UseShellExecute = true,
            Verb = "runas",
        };
        var proc = Process.Start(psi) ?? throw new InvalidOperationException("Failed to start uninstaller.");
        return new { pid = proc.Id, path = canonical };
    }

    private static (string File, string Args) ParseCommandLine(string commandLine)
    {
        var s = commandLine.Trim();
        if (s.StartsWith('"'))
        {
            var end = s.IndexOf('"', 1);
            if (end > 1)
            {
                var file = s[1..end];
                var args = s[(end + 1)..].Trim();
                return (file, args);
            }
        }

        var parts = s.Split(' ', 2, StringSplitOptions.RemoveEmptyEntries);
        return parts.Length == 1 ? (parts[0], "") : (parts[0], parts[1]);
    }
}
