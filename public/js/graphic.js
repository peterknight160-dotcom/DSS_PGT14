




function click_box() {  //this is declares the function. If the function had paramaters, these would be included in the brackets
	// When mouse down in the image "box" , pop up and alert the message "You clicked the image! and the coordinates of the click
	document.getElementById('box').addEventListener('mousedown', function (event) {
		var x = event.clientX;
		var y = event.clientY;
		var n = Math.floor((x - 13) / 48) + 1 + Math.floor((y - 150) / 48) * 10;
		if (x < 495)

			fetch('/click', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ x, y, n })
			})
				.then(res => res.json())
				.then(data => {
					if (data.redirect) {
						window.location.href = data.redirect;
					}


				})
				.catch(err => {
					console.error('Error:', err);
				});


	});
};


