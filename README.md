# set-system-time
Signal K Node server plugin to set system time on time data from GPS
<br>

![UI image](https://i.imgur.com/K0IZQxG.png "UI image")
<br>
<br>

# Configuration Interface
###  Use sudo when setting the time :
When this option is checked, **set-system-time plugin** will try to use `sudo` to set the date. 
It's required that sudo have a password-less access to the `date` command.


To give `sudo` a no password access only to the `date` command, you can add the following line to your sudoers file : 
```
pi ALL=(ALL) NOPASSWD: /bin/date
```
 --- *In this example, **pi** is the username that run the signalk server. Yours could be different.*

Sudo is not available in Signal K Server image, but setting time should work without it with the latest Docker image.
