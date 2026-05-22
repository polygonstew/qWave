using System.Text.Json;
using QueueWave.Models;

namespace QueueWave.Services;

public class PersistenceService
{
    // Stored in %APPDATA%/QueueWave on Windows,
    // ~/.config/QueueWave on Linux (XDG_CONFIG_HOME)
    private static readonly string Dir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "QueueWave");

    private static readonly string AutoSavePath = Path.Combine(Dir, "state.json");

    private static readonly JsonSerializerOptions Opts = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true
    };

    public async Task AutoSaveAsync(AppState state)
    {
        Directory.CreateDirectory(Dir);
        await File.WriteAllTextAsync(AutoSavePath,
            JsonSerializer.Serialize(state, Opts));
    }

    public async Task<AppState?> AutoLoadAsync()
    {
        if (!File.Exists(AutoSavePath)) return null;
        var json = await File.ReadAllTextAsync(AutoSavePath);
        return JsonSerializer.Deserialize<AppState>(json, Opts);
    }

    public async Task ExportAsync(AppState state, string path)
        => await File.WriteAllTextAsync(path, JsonSerializer.Serialize(state, Opts));

    public async Task<AppState?> ImportAsync(string path)
    {
        var json = await File.ReadAllTextAsync(path);
        return JsonSerializer.Deserialize<AppState>(json, Opts);
    }
}