using LibVLCSharp.Shared;

namespace QueueWave.Services;

public class PlayerService : IDisposable
{
    private readonly LibVLC      _vlc;
    private readonly MediaPlayer _mp;

    public event Action<TimeSpan, TimeSpan>? ProgressChanged;
    public event Action?                      TrackEnded;
    public event Action<bool>?                PlayStateChanged;

    public bool    IsPlaying  => _mp.IsPlaying;
    public float   Volume
    {
        get => _mp.Volume / 100f;
        set => _mp.Volume = (int)(value * 100);
    }
    public float Rate
    {
        get => _mp.Rate;
        set => _mp.SetRate(value);     // ← use the method instead
    }

    public PlayerService()
    {
        Core.Initialize();                          // required once
        _vlc = new LibVLC("--no-video");
        _mp  = new MediaPlayer(_vlc);

        _mp.TimeChanged   += (_, e) =>
        {
            var cur = TimeSpan.FromMilliseconds(e.Time);
            var tot = TimeSpan.FromMilliseconds(_mp.Length);
            ProgressChanged?.Invoke(cur, tot);
        };
        _mp.EndReached    += (_, _) => TrackEnded?.Invoke();
        _mp.Playing       += (_, _) => PlayStateChanged?.Invoke(true);
        _mp.Paused        += (_, _) => PlayStateChanged?.Invoke(false);
        _mp.Stopped       += (_, _) => PlayStateChanged?.Invoke(false);
    }

    public void Play(string url)
    {
        var media = new Media(_vlc, url, FromType.FromLocation);
        _mp.Play(media);
        media.Dispose();
    }

    public void TogglePlay()
    {
        if (_mp.IsPlaying) _mp.Pause();
        else _mp.Play();
    }

    public void Pause()  => _mp.Pause();
    public void Stop()   => _mp.Stop();

    public void Seek(double fraction)
    {
        if (_mp.IsSeekable)
            _mp.Position = (float)Math.Clamp(fraction, 0, 1);
    }

    public void SkipSeconds(int seconds)
    {
        var target = _mp.Time + seconds * 1000L;
        _mp.Time = Math.Clamp(target, 0, _mp.Length);
    }

    public void Dispose() { _mp.Dispose(); _vlc.Dispose(); }
}