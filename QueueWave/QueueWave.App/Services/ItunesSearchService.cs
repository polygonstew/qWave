using System.Net.Http;
using System.Text.Json;
using QueueWave.Models;

namespace QueueWave.Services;

public record PodcastSearchResult(
    string CollectionName,
    string ArtistName,
    string FeedUrl,
    string ArtworkUrl100,
    int    TrackCount,
    string PrimaryGenreName
);

public class ItunesSearchService
{
    private static readonly HttpClient Http = new();

    public async Task<List<PodcastSearchResult>> SearchAsync(string query)
    {
        var url = $"https://itunes.apple.com/search?term={Uri.EscapeDataString(query)}" +
                  "&media=podcast&entity=podcast&limit=25";
        var json = await Http.GetStringAsync(url);
        using var doc = JsonDocument.Parse(json);
        var results = doc.RootElement.GetProperty("results");
        return results.EnumerateArray()
            .Where(r => r.TryGetProperty("feedUrl", out _))
            .Select(r => new PodcastSearchResult(
                r.TryGetProperty("collectionName",   out var cn)  ? cn.GetString()  ?? "" : "",
                r.TryGetProperty("artistName",       out var an)  ? an.GetString()  ?? "" : "",
                r.TryGetProperty("feedUrl",          out var fu)  ? fu.GetString()  ?? "" : "",
                r.TryGetProperty("artworkUrl100",    out var art) ? art.GetString() ?? "" : "",
                r.TryGetProperty("trackCount",       out var tc)  ? tc.GetInt32()        : 0,
                r.TryGetProperty("primaryGenreName", out var gn)  ? gn.GetString()  ?? "" : ""
            ))
            .ToList();
    }
}