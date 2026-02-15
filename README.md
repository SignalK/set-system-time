# set-system-time
Signal K Node server plugin to set system time on time data from GPS
<br>

![UI image](https://i.imgur.com/K0IZQxG.png "UI image")
<br>
<br>

# Configuration
## Options
- **interval** (seconds): How often to apply updates. `0` means once on plugin start when the first datetime is received.
- **sudo**: Use `sudo` as a fallback when setting time without sudo fails. Requires passwordless access to the `date` command.
- **preferNetworkTime**: Only set system time if no other source is available. This currently checks for `chrony` via `chronyc sources`, so `chronyc` must be installed and accessible.

## Use sudo when setting the time
When this option is checked, **set-system-time plugin** will try to use `sudo` to set the date.
It's required that sudo have a password-less access to the `date` command.


To give `sudo` a no password access only to the `date` command, you can add the following line to your sudoers file : 
```
pi ALL=(ALL) NOPASSWD: /bin/date
```
 --- *In this example, **pi** is the username that run the signalk server. Yours could be different.*

Sudo is not available in Signal K Server image, but setting time should work without it with the latest Docker image.

# Sanity checks
GPS time values that are clearly wrong or too old are ignored. The plugin rejects invalid datetime formats, dates earlier than a minimum year, and values that are older than the last known good time (with a short grace window).
