using System.Net.Http;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using QueueWave.Models;

namespace QueueWave.Services;

public class RssService
{
    private static readonly HttpClient Http = new()
    {
        DefaultRequestHeaders = { { "User-Agent", "QueueWave/1.0" } },
        Timeout = TimeSpan.FromSeconds(15)
    };

    // iTunes namespace
    static readonly XNamespace Itunes = "http://www.itunes.com/dtds/podcast-1.0.dtd";
    static readonly XNamespace Media  = "http://search.yahoo.com/mrss/";

    public async Task<PodcastFeed?> LoadAsync(string url)
    {
        string xml;
        try { xml = await Http.GetStringAsync(url); }
        catch
        {
            // try CORS proxy as fallback — not needed in a native app!
            // Native apps have no CORS restriction — direct fetch always works.
            throw;
        }
        return Parse(xml, url, url);
    }

    public async Task<PodcastFeed?> LoadFromFileAsync(string path)
    {
        var xml = await File.ReadAllTextAsync(path);
        return Parse(xml, Path.GetFileNameWithoutExtension(path), $"__local__:{path}");
    }

    public PodcastFeed? Parse(string xml, string fallbackName, string sourceUrl)
    {
        XDocument doc;
        try { doc = XDocument.Parse(xml); }
        catch { return null; }

        var ch = doc.Root?.Element("channel") ?? doc.Root;
        if (ch is null) return null;

        var name   = ch.Element("title")?.Value?.Trim() ?? fallbackName;
        var chArt  = ch.Element(Itunes + "image")?.Attribute("href")?.Value
                  ?? ch.Element("image")?.Element("url")?.Value
                  ?? string.Empty;

        var feedId = Guid.NewGuid().ToString("N")[..8];

        var items = ch.Elements("item").Concat(ch.Elements("entry"))
            .Select((el, i) => ParseItem(el, i, feedId, name, chArt))
            .ToList();

        return new PodcastFeed
        {
            Id = feedId, Name = name, Url = sourceUrl,
            ArtUrl = chArt, Items = items,
            LastRefresh = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
    }

    private static FeedItem ParseItem(XElement el, int i, string feedId,
                                      string feedName, string chArt)
    {
        var title    = el.Element("title")?.Value?.Trim() ?? $"Item {i+1}";
        var enc      = el.Element("enclosure");
        var audioUrl = enc?.Attribute("url")?.Value
                    ?? el.Element("link")?.Value
                    ?? el.Element("link")?.Attribute("href")?.Value
                    ?? string.Empty;
        var encType  = enc?.Attribute("type")?.Value ?? string.Empty;
        var isAudio  = encType.StartsWith("audio", StringComparison.OrdinalIgnoreCase)
                    || Regex.IsMatch(audioUrl,
                           @"\.(mp3|m4a|ogg|opus|wav|aac|flac)(\?|$)",
                           RegexOptions.IgnoreCase);

        var itemArt  = el.Element(Itunes + "image")?.Attribute("href")?.Value
                    ?? el.Element(Media + "thumbnail")?.Attribute("url")?.Value
                    ?? chArt;

        var rawDesc  = el.Element(Itunes + "summary")?.Value
                    ?? el.Element("description")?.Value
                    ?? el.Element("summary")?.Value
                    ?? string.Empty;
        var desc     = Regex.Replace(rawDesc, "<.*?>", " ").Trim();
        if (desc.Length > 500) desc = desc[..500] + "…";

        var rawDate  = el.Element("pubDate")?.Value
                    ?? el.Element("published")?.Value ?? string.Empty;
        var ts       = DateTimeOffset.TryParse(rawDate, out var dt)
                     ? dt.ToUnixTimeMilliseconds() : 0L;
        var date     = ts > 0
                     ? DateTimeOffset.FromUnixTimeMilliseconds(ts)
                                     .ToString("MMM d, yyyy") : string.Empty;

        var durRaw   = el.Element(Itunes + "duration")?.Value
                    ?? el.Element("duration")?.Value ?? string.Empty;

        return new FeedItem
        {
            Title = title, AudioUrl = audioUrl, ArtUrl = itemArt,
            Description = desc, Duration = FormatDuration(durRaw),
            PublishDate = date, Timestamp = ts,
            IsAudio = isAudio, FeedName = feedName, FeedId = feedId
        };
    }

    private static string FormatDuration(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return string.Empty;
        if (Regex.IsMatch(raw, @"^\d{1,2}:\d{2}")) return raw;
        if (int.TryParse(raw, out var secs) && secs > 0)
        {
            var h = secs / 3600; var m = (secs % 3600) / 60; var s = secs % 60;
            return h > 0 ? $"{h}:{m:D2}:{s:D2}" : $"{m}:{s:D2}";
        }
        return raw;
    }
}