using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using QueueWave.ViewModels;
using QueueWave.Views;
namespace QueueWave;

public partial class QueueWaveApp : Application
{
    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            var vm  = new MainViewModel();
            var win = new PlayerWindow { DataContext = vm };

            // Wire sleep event from ViewModel to window
            vm.SleepRequested += win.ShowBlackout;

            desktop.MainWindow = win;
            desktop.MainWindow.Loaded += async (_, _)
                => await vm.LoadSavedStateAsync();
        }
        base.OnFrameworkInitializationCompleted();
    }
}