using System.Security.Principal;

namespace CullSpace.Helper;

public static class Security
{
    private static readonly string[] ProtectedRoots = BuildProtectedRoots();

    /// <summary>
    /// Soft-protected exact roots: block deletes / mutation. UserProfile is scannable on drive
    /// walks; Program Files is scannable only when the caller opts in via includeProgramFiles.
    /// </summary>
    private static readonly HashSet<string> ProtectedExact = new(StringComparer.OrdinalIgnoreCase)
    {
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        Environment.GetFolderPath(Environment.SpecialFolder.Windows),
        Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
        Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
        Path.GetPathRoot(Environment.SystemDirectory) ?? @"C:\",
    };

    private static string[] BuildProtectedRoots()
    {
        var list = new List<string>
        {
            Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            Environment.GetFolderPath(Environment.SpecialFolder.System),
            Environment.GetFolderPath(Environment.SpecialFolder.SystemX86),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "SysWOW64"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "WindowsApps"),
        };

        var common = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        if (!string.IsNullOrEmpty(common))
            list.Add(Path.Combine(common, "Microsoft"));

        return list.Where(p => !string.IsNullOrWhiteSpace(p)).ToArray();
    }

    public static bool IsAdministrator()
    {
        using var identity = WindowsIdentity.GetCurrent();
        var principal = new WindowsPrincipal(identity);
        return principal.IsInRole(WindowsBuiltInRole.Administrator);
    }

    public static string? TryCanonicalize(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return null;
        if (path.Contains("..", StringComparison.Ordinal))
            return null;

        try
        {
            var full = Path.GetFullPath(path);
            if (!Path.IsPathRooted(full))
                return null;
            return full;
        }
        catch
        {
            return null;
        }
    }

    public static bool IsProtectedPath(string canonicalPath)
    {
        var trimmed = canonicalPath.TrimEnd('\\');
        if (ProtectedExact.Contains(trimmed))
            return true;

        return IsHardProtectedPath(trimmed);
    }

    /// <summary>
    /// Windows / System32 / WindowsApps trees that must never be scanned or deleted.
    /// User profile and Program Files are soft-protected (not hard).
    /// </summary>
    public static bool IsHardProtectedPath(string canonicalPath)
    {
        var trimmed = canonicalPath.TrimEnd('\\');
        var windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        if (!string.IsNullOrEmpty(windows) &&
            string.Equals(trimmed, windows.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        foreach (var root in ProtectedRoots)
        {
            var r = Path.GetFullPath(root).TrimEnd('\\') + "\\";
            var p = trimmed + "\\";
            if (p.StartsWith(r, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    public static bool IsUnderOrEqual(string path, string ancestor)
    {
        var p = Path.GetFullPath(path).TrimEnd('\\') + "\\";
        var a = Path.GetFullPath(ancestor).TrimEnd('\\') + "\\";
        return p.StartsWith(a, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Explicit folder scan may start at UserProfile / Program Files (or under them).
    /// Hard system paths are always refused.
    /// </summary>
    public static void EnsureFolderScanRootAllowed(string canonicalRoot)
    {
        if (IsHardProtectedPath(canonicalRoot))
            throw new InvalidOperationException($"Refusing to scan protected system path: {canonicalRoot}");
    }

    /// <summary>True when path is the current user's profile root (soft-protected for deletes).</summary>
    public static bool IsUserProfileRoot(string canonicalPath)
    {
        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (string.IsNullOrEmpty(profile))
            return false;
        return string.Equals(
            canonicalPath.TrimEnd('\\'),
            profile.TrimEnd('\\'),
            StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>True when path is Program Files or Program Files (x86) root.</summary>
    public static bool IsProgramFilesRoot(string canonicalPath)
    {
        var trimmed = canonicalPath.TrimEnd('\\');
        foreach (var root in new[]
                 {
                     Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                     Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                 })
        {
            if (string.IsNullOrEmpty(root))
                continue;
            if (string.Equals(trimmed, root.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    public static bool IsUnderAllowedDrives(string canonicalPath, IEnumerable<string> allowedDrives)
    {
        var root = Path.GetPathRoot(canonicalPath);
        if (string.IsNullOrEmpty(root))
            return false;

        foreach (var d in allowedDrives)
        {
            var driveRoot = Path.GetPathRoot(Path.GetFullPath(d));
            if (!string.IsNullOrEmpty(driveRoot) &&
                string.Equals(root, driveRoot, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    public static void EnsureLogDir()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "CullSpace",
            "logs");
        Directory.CreateDirectory(dir);
    }

    public static void Audit(string message)
    {
        try
        {
            EnsureLogDir();
            var path = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CullSpace",
                "logs",
                $"audit-{DateTime.UtcNow:yyyyMMdd}.log");
            File.AppendAllText(path, $"{DateTime.UtcNow:o} {message}{Environment.NewLine}");
        }
        catch
        {
            // best-effort audit
        }
    }
}
